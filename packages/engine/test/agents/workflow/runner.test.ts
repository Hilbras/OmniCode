import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowBudgetLedger } from '#/agent/team/workflowBudget';
import { WorkflowErrors } from '#/agents/runtime/workflow/errors';
import {
  parseWorkflowJournalEntries,
  replayWorkflowJournal,
  WorkflowJournal,
} from '#/agents/runtime/workflow/journal';
import {
  WorkflowRunner,
  type WorkflowStepExecutor,
  type WorkflowStepOutcome,
  type WorkflowTokenBudget,
} from '#/agents/runtime/workflow/runner';
import {
  parseWorkflowScript,
  type WorkflowScript,
  type WorkflowStep,
} from '#/agents/runtime/workflow/script';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  }
  return undefined;
}

function makeScript(steps: Array<Record<string, unknown>>): WorkflowScript {
  return parseWorkflowScript({ id: 'wf', steps });
}

function done(stepId: string): WorkflowStepOutcome {
  return { ok: true, tokensUsed: 1, summary: `done:${stepId}` };
}

class ExecutorHarness {
  readonly started: string[] = [];
  readonly receivedSteps = new Map<string, WorkflowStep>();
  readonly signals = new Map<string, AbortSignal>();
  maxInFlight = 0;
  private currentInFlight = 0;
  private readonly gates = new Map<string, Deferred<WorkflowStepOutcome>>();
  private readonly gateWaiters: Array<Deferred<void>> = [];

  readonly executor: WorkflowStepExecutor = (step, context) => {
    this.started.push(step.id);
    this.receivedSteps.set(step.id, step);
    this.signals.set(step.id, context.signal);
    this.currentInFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.currentInFlight);
    const gate = deferred<WorkflowStepOutcome>();
    this.gates.set(step.id, gate);
    for (const waiter of this.gateWaiters.splice(0)) waiter.resolve();
    return gate.promise.then((outcome) => {
      this.currentInFlight -= 1;
      return outcome;
    });
  };

  called(stepId: string): Promise<void> {
    if (this.gates.has(stepId)) return Promise.resolve();
    const waiter = deferred<void>();
    this.gateWaiters.push(waiter);
    return waiter.promise;
  }

  release(stepId: string, outcome: WorkflowStepOutcome = done(stepId)): void {
    const gate = this.gates.get(stepId);
    if (gate === undefined) throw new Error(`No gate for step ${stepId}`);
    this.gates.delete(stepId);
    gate.resolve(outcome);
  }

  failWith(stepId: string, error: unknown): void {
    const gate = this.gates.get(stepId);
    if (gate === undefined) throw new Error(`No gate for step ${stepId}`);
    this.gates.delete(stepId);
    gate.reject(error);
  }
}

const READ_TOOLS = new Set<string>(['Read', 'Bash']);

describe('WorkflowRunner execution', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a dependency DAG through the concurrency window', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Bash', args: {}, dependsOn: ['a'] },
      { id: 'c', tool: 'Read', args: {}, dependsOn: ['a'] },
    ]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 2,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a');
    await harness.called('b');
    await harness.called('c');
    expect(harness.maxInFlight).toBe(2);
    harness.release('b');
    harness.release('c');
    const summary = await runPromise;

    expect(summary.status).toBe('completed');
    expect(summary.error).toBeUndefined();
    expect(summary.completed).toEqual(['a', 'b', 'c']);
    expect(summary.failed).toEqual([]);
    expect(summary.refused).toEqual([]);
    expect(summary.skipped).toEqual([]);
    expect(summary.tokensUsed).toBe(3);
    expect(summary.workflowId).toBe('wf');
    expect(summary.startedAt).toBeLessThanOrEqual(summary.endedAt);
    expect(harness.receivedSteps.get('a')).toMatchObject({ id: 'a', tool: 'Read', args: {} });
    expect(harness.signals.get('a')).toBeInstanceOf(AbortSignal);

    const state = replayWorkflowJournal(runner.journalRef.read());
    expect(state.terminal).toBe('completed');
    expect(state.steps.get('a')).toMatchObject({ status: 'completed', tokensUsed: 1 });
  });

  it('serializes steps when the window is one', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Read', args: {} },
      { id: 'c', tool: 'Read', args: {} },
    ]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    expect(harness.started).toEqual(['a']);
    harness.release('a');
    await harness.called('b');
    expect(harness.started).toEqual(['a', 'b']);
    harness.release('b');
    await harness.called('c');
    harness.release('c');
    const summary = await runPromise;
    expect(summary.status).toBe('completed');
    expect(harness.maxInFlight).toBe(1);
    expect(harness.started).toEqual(['a', 'b', 'c']);
  });

  it('refuses a step whose tool is not admitted and skips its downstream', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Write', args: {}, dependsOn: ['a'] },
      { id: 'c', tool: 'Read', args: {}, dependsOn: ['b'] },
    ]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 4,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a');
    const summary = await runPromise;

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({ code: WorkflowErrors.codes.WORKFLOW_TOOL_NOT_ALLOWED });
    expect(summary.completed).toEqual(['a']);
    expect(summary.refused).toEqual(['b']);
    expect(summary.skipped).toEqual(['c']);

    const entries = runner.journalRef.read();
    const refused = entries.find((entry) => entry.type === 'step.refused');
    expect(refused).toMatchObject({ stepId: 'b', reason: 'tool-not-allowed' });
    const terminal = entries.at(-1);
    expect(terminal).toMatchObject({ type: 'workflow.failed', reason: 'workflow.tool_not_allowed' });
  });

  it('admits nothing when no allowlist is provided', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const runner = new WorkflowRunner({
      script,
      executor: () => Promise.resolve(done('a')),
      maxConcurrentSteps: 1,
    });
    const summary = await runner.run();
    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({ code: WorkflowErrors.codes.WORKFLOW_TOOL_NOT_ALLOWED });
    expect(summary.refused).toEqual(['a']);
  });

  it('records an executor failure and stops launching new steps', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Read', args: {} },
    ]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.failWith('a', new Error('executor exploded'));
    const summary = await runPromise;

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({
      code: WorkflowErrors.codes.WORKFLOW_STEP_FAILED,
      message: expect.stringContaining('executor exploded'),
    });
    expect(summary.failed).toEqual(['a']);
    expect(summary.skipped).toEqual(['b']);
    expect(harness.started).toEqual(['a']);
    const failedEntry = runner.journalRef.read().find((entry) => entry.type === 'step.failed');
    expect(failedEntry).toMatchObject({ stepId: 'a', error: 'executor exploded' });
  });

  it('counts partial token usage from failed steps', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Read', args: {} },
    ]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a');
    await harness.called('b');
    harness.release('b', { ok: false, tokensUsed: 5, error: 'late failure' });
    const summary = await runPromise;
    expect(summary.tokensUsed).toBe(6);
    expect(summary.status).toBe('failed');
  });

  it('rejects an invalid tokensUsed outcome instead of counting it', async () => {
    for (const tokensUsed of [Number.NaN, -5]) {
      const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
      const harness = new ExecutorHarness();
      const runner = new WorkflowRunner({
        script,
        executor: harness.executor,
        allowedTools: READ_TOOLS,
        maxConcurrentSteps: 1,
      });
      const runPromise = runner.run();
      await harness.called('a');
      harness.release('a', { ok: true, tokensUsed });
      const summary = await runPromise;

      expect(summary.status).toBe('failed');
      expect(summary.error).toMatchObject({
        code: WorkflowErrors.codes.WORKFLOW_STEP_FAILED,
        message: expect.stringContaining('invalid tokensUsed'),
      });
      expect(summary.failed).toEqual(['a']);
      expect(summary.tokensUsed).toBe(0);
      const failedEntry = runner.journalRef.read().find((entry) => entry.type === 'step.failed');
      expect(failedEntry).toMatchObject({
        stepId: 'a',
        error: 'executor reported an invalid tokensUsed value',
      });
    }
  });
});

describe('WorkflowRunner token budget', () => {
  it('reserves and settles spend through a real budget ledger', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {}, estimatedTokens: 30 },
      { id: 'b', tool: 'Read', args: {}, estimatedTokens: 40 },
    ]);
    const harness = new ExecutorHarness();
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 100 });
    const budget: WorkflowTokenBudget = ledger;
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      budget,
      maxConcurrentSteps: 2,
    });
    const runPromise = runner.run();
    await harness.called('a');
    await harness.called('b');
    harness.release('a');
    harness.release('b');
    const summary = await runPromise;

    expect(summary.status).toBe('completed');
    expect(summary.tokensUsed).toBe(2);
    expect(ledger.getBudget('wf')?.used).toMatchObject({ tokens: 2 });
    expect(ledger.getBudget('wf')?.reserved).toMatchObject({ tokens: 0 });
  });

  it('fails the workflow when the budget refuses a reservation and releases in-flight spend', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {}, estimatedTokens: 40 },
      { id: 'b', tool: 'Read', args: {}, estimatedTokens: 40 },
    ]);
    const harness = new ExecutorHarness();
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 50 });
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      budget: ledger,
      maxConcurrentSteps: 2,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a');
    const summary = await runPromise;

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({ code: WorkflowErrors.codes.WORKFLOW_BUDGET_EXHAUSTED });
    expect(summary.refused).toEqual(['b']);
    expect(summary.completed).toEqual(['a']);
    expect(ledger.getBudget('wf')?.reserved).toMatchObject({ tokens: 0 });
    expect(ledger.getBudget('wf')?.used).toMatchObject({ tokens: 1 });
  });

  it('refuses to start a step without any estimate while a budget is active', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 100 });
    const runner = new WorkflowRunner({
      script,
      executor: () => Promise.resolve(done('a')),
      allowedTools: READ_TOOLS,
      budget: ledger,
      maxConcurrentSteps: 1,
    });
    const summary = await runner.run();
    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({
      code: WorkflowErrors.codes.WORKFLOW_BUDGET_ESTIMATE_MISSING,
    });
    expect(summary.refused).toEqual(['a']);
  });

  it('falls back to defaultStepTokenEstimate when a step has none', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const harness = new ExecutorHarness();
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 100 });
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      budget: ledger,
      defaultStepTokenEstimate: 25,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a');
    const summary = await runPromise;
    expect(summary.status).toBe('completed');
    expect(ledger.getBudget('wf')?.used).toMatchObject({ tokens: 1 });
  });

  it('fails the workflow when settling exceeds the budget', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {}, estimatedTokens: 10 }]);
    const harness = new ExecutorHarness();
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 100 });
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      budget: ledger,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a', { ok: true, tokensUsed: 200 });
    const summary = await runPromise;

    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({ code: WorkflowErrors.codes.WORKFLOW_BUDGET_EXHAUSTED });
    expect(summary.tokensUsed).toBe(200);
    expect(summary.completed).toEqual(['a']);
    expect(ledger.getBudget('wf')?.reserved).toMatchObject({ tokens: 0 });
  });
});

describe('WorkflowRunner stall detection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a stalled step and journals the stall before the failure', async () => {
    vi.useFakeTimers();
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const executor: WorkflowStepExecutor = (_step, { signal }) =>
      new Promise<WorkflowStepOutcome>((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve({ ok: false, error: 'aborted by stall watchdog' }),
          { once: true },
        );
      });
    const runner = new WorkflowRunner({
      script,
      executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
      stallTimeoutMs: 1_000,
    });
    const runPromise = runner.run();
    vi.advanceTimersByTime(1_000);
    const summary = await runPromise;

    expect(summary.status).toBe('failed');
    expect(summary.failed).toEqual(['a']);
    expect(summary.error).toMatchObject({ code: WorkflowErrors.codes.WORKFLOW_STEP_FAILED });
    const entries = runner.journalRef.read();
    const stalled = entries.find((entry) => entry.type === 'step.stalled');
    expect(stalled).toMatchObject({ stepId: 'a', afterMs: 1_000 });
    expect(entries.findIndex((entry) => entry.type === 'step.stalled')).toBeLessThan(
      entries.findIndex((entry) => entry.type === 'step.failed'),
    );
    const failed = entries.find((entry) => entry.type === 'step.failed');
    expect(failed).toMatchObject({ stepId: 'a', error: 'aborted by stall watchdog' });
  });

  it('does not report a stall when the step settles inside the window', async () => {
    vi.useFakeTimers();
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
      stallTimeoutMs: 1_000,
    });
    const runPromise = runner.run();
    harness.release('a');
    const summary = await runPromise;
    vi.advanceTimersByTime(5_000);
    expect(summary.status).toBe('completed');
    expect(runner.journalRef.read().some((entry) => entry.type === 'step.stalled')).toBe(false);
  });
});

describe('WorkflowRunner resume and checkpoints', () => {
  it('resumes from the journal, skipping completed steps and re-running the rest', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Read', args: {}, dependsOn: ['a'] },
      { id: 'c', tool: 'Read', args: {}, dependsOn: ['b'] },
    ]);
    const first = new ExecutorHarness();
    const journal = new WorkflowJournal();
    const firstRunner = new WorkflowRunner({
      script,
      executor: first.executor,
      allowedTools: READ_TOOLS,
      journal,
      maxConcurrentSteps: 1,
    });
    const firstRun = firstRunner.run();
    await first.called('a');
    first.release('a');
    await first.called('b');
    first.release('b', { ok: false, error: 'flaky' });
    const firstSummary = await firstRun;
    expect(firstSummary.status).toBe('failed');
    expect(firstSummary.completed).toEqual(['a']);
    expect(firstSummary.failed).toEqual(['b']);
    expect(firstSummary.skipped).toEqual(['c']);
    const seqAfterFirstRun = journal.length;

    const restored = new WorkflowJournal({
      entries: parseWorkflowJournalEntries(JSON.parse(JSON.stringify(journal.read()))),
    });
    const second = new ExecutorHarness();
    const secondRunner = new WorkflowRunner({
      script,
      executor: second.executor,
      allowedTools: READ_TOOLS,
      journal: restored,
      maxConcurrentSteps: 1,
    });
    const secondRun = secondRunner.run();
    await second.called('b');
    second.release('b');
    await second.called('c');
    second.release('c');
    const secondSummary = await secondRun;

    expect(secondSummary.status).toBe('completed');
    expect(secondSummary.completed).toEqual(['a', 'b', 'c']);
    expect(second.started).toEqual(['b', 'c']);
    expect(secondSummary.tokensUsed).toBe(2);
    expect(restored.read().length).toBeGreaterThan(seqAfterFirstRun);
    expect(restored.read()[seqAfterFirstRun]).toMatchObject({
      type: 'workflow.resumed',
      fromSeq: seqAfterFirstRun,
    });
    const state = replayWorkflowJournal(restored.read());
    expect(state.terminal).toBe('completed');
    expect(state.steps.get('b')).toMatchObject({ status: 'completed' });
  });

  it('refuses to resume a journal with a different script or workflow id', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const journal = new WorkflowJournal();
    const firstRunner = new WorkflowRunner({
      script,
      executor: () => Promise.resolve(done('a')),
      allowedTools: READ_TOOLS,
      journal,
      maxConcurrentSteps: 1,
    });
    await firstRunner.run();

    const changedScript = makeScript([{ id: 'a', tool: 'Read', args: { path: 'other' } }]);
    const mismatched = new WorkflowRunner({
      script: changedScript,
      executor: () => Promise.resolve(done('a')),
      allowedTools: READ_TOOLS,
      journal,
      maxConcurrentSteps: 1,
    });
    await expect(mismatched.run()).rejects.toMatchObject({
      code: WorkflowErrors.codes.WORKFLOW_SCRIPT_MISMATCH,
    });

    const renamedScript = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const renamed: WorkflowScript = { ...renamedScript, id: 'other-wf' };
    const wrongId = new WorkflowRunner({
      script: renamed,
      executor: () => Promise.resolve(done('a')),
      allowedTools: READ_TOOLS,
      journal,
      maxConcurrentSteps: 1,
    });
    await expect(wrongId.run()).rejects.toMatchObject({
      code: WorkflowErrors.codes.WORKFLOW_SCRIPT_MISMATCH,
    });
  });

  it('exposes a checkpoint whose state matches the journal replay', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    const checkpoint = runner.journalRef.checkpoint();
    expect(checkpoint.state.steps.get('a')).toMatchObject({ status: 'running' });
    harness.release('a');
    await runPromise;
    const finalCheckpoint = runner.journalRef.checkpoint();
    expect(finalCheckpoint.seq).toBe(runner.journalRef.length);
    expect(finalCheckpoint.state.terminal).toBe('completed');
    expect(finalCheckpoint.state.steps.get('a')).toMatchObject({ status: 'completed' });
  });
});

describe('WorkflowRunner construction and run guards', () => {
  it('requires an executor and valid options', () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    expect(
      thrownCode(
        () =>
          new WorkflowRunner({
            script,
            executor: undefined as unknown as WorkflowStepExecutor,
            maxConcurrentSteps: 1,
          }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_EXECUTOR_MISSING);
    expect(
      thrownCode(
        () =>
          new WorkflowRunner({
            script,
            executor: () => Promise.resolve(done('a')),
            maxConcurrentSteps: 0,
          }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS);
    expect(
      thrownCode(
        () =>
          new WorkflowRunner({
            script,
            executor: () => Promise.resolve(done('a')),
            maxConcurrentSteps: 1,
            stallTimeoutMs: -5,
          }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS);
  });

  it('rejects a second concurrent run and reports the running flag', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    expect(runner.running).toBe(true);
    await expect(runner.run()).rejects.toMatchObject({
      code: WorkflowErrors.codes.WORKFLOW_ALREADY_RUNNING,
    });
    harness.release('a');
    const summary = await runPromise;
    expect(summary.status).toBe('completed');
    expect(runner.running).toBe(false);
  });

  it('fails a raw cyclic script through the deadlock guard instead of hanging', async () => {
    const raw = {
      id: 'wf',
      steps: [
        { id: 'a', tool: 'Read', args: {}, dependsOn: ['b'] },
        { id: 'b', tool: 'Read', args: {}, dependsOn: ['a'] },
      ],
    } as unknown as WorkflowScript;
    const executor = vi.fn(() => Promise.resolve(done('a')));
    const runner = new WorkflowRunner({
      script: raw,
      executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 2,
    });
    const summary = await runner.run();

    expect(executor).not.toHaveBeenCalled();
    expect(summary.status).toBe('failed');
    expect(summary.error).toMatchObject({ code: WorkflowErrors.codes.WORKFLOW_DEADLOCKED });
    expect(summary.completed).toEqual([]);
    expect(summary.skipped).toEqual(['a', 'b']);
    const entries = runner.journalRef.read();
    const terminal = entries.at(-1);
    expect(terminal).toMatchObject({ type: 'workflow.failed', reason: 'workflow.deadlocked' });
    expect(entries.filter((entry) => entry.type === 'step.skipped')).toHaveLength(2);
  });

  it('writes journal entries with the injected clock', async () => {
    const script = makeScript([{ id: 'a', tool: 'Read', args: {} }]);
    const harness = new ExecutorHarness();
    let clock = 100;
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
      now: () => clock,
    });
    const runPromise = runner.run();
    await harness.called('a');
    clock = 200;
    harness.release('a');
    await runPromise;
    const entries = runner.journalRef.read();
    expect(entries[0]).toMatchObject({ type: 'workflow.started', at: 100 });
    const completed = entries.find((entry) => entry.type === 'step.completed');
    expect(completed).toMatchObject({ at: 200 });
  });

  it('journals valid contiguous entries for a full run', async () => {
    const script = makeScript([
      { id: 'a', tool: 'Read', args: {} },
      { id: 'b', tool: 'Read', args: {}, dependsOn: ['a'] },
    ]);
    const harness = new ExecutorHarness();
    const runner = new WorkflowRunner({
      script,
      executor: harness.executor,
      allowedTools: READ_TOOLS,
      maxConcurrentSteps: 1,
    });
    const runPromise = runner.run();
    await harness.called('a');
    harness.release('a');
    await harness.called('b');
    harness.release('b');
    await runPromise;
    const entries = parseWorkflowJournalEntries(JSON.parse(JSON.stringify(runner.journalRef.read())));
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(entries.map((entry) => entry.type)).toEqual([
      'workflow.started',
      'step.started',
      'step.completed',
      'step.started',
      'step.completed',
      'workflow.completed',
    ]);
  });
});
