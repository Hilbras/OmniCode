import { Error2 } from '#/errors';

import { WorkflowErrors } from './errors';
import { WorkflowJournal, type WorkflowReplayState } from './journal';
import {
  workflowScriptFingerprint,
  type WorkflowScript,
  type WorkflowStep,
} from './script';

export interface WorkflowStepOutcome {
  readonly ok: boolean;
  readonly tokensUsed?: number;
  readonly summary?: string;
  readonly error?: string;
}

export interface WorkflowStepExecutionContext {
  readonly signal: AbortSignal;
}

export type WorkflowStepExecutor = (
  step: WorkflowStep,
  context: WorkflowStepExecutionContext,
) => Promise<WorkflowStepOutcome>;

export interface WorkflowTokenBudget {
  reserve(workflowId: string, amount: { readonly tokens?: number }): { readonly id: string };
  record(reservationId: string, actual?: { readonly tokens?: number }): unknown;
  release(reservationId: string): unknown;
}

export interface WorkflowRunError {
  readonly code: string;
  readonly message: string;
}

export interface WorkflowRunSummary {
  readonly status: 'completed' | 'failed';
  readonly workflowId: string;
  readonly fingerprint: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly completed: readonly string[];
  readonly failed: readonly string[];
  readonly refused: readonly string[];
  readonly skipped: readonly string[];
  readonly tokensUsed: number;
  readonly error?: WorkflowRunError;
}

export interface WorkflowRunnerOptions {
  readonly script: WorkflowScript;
  readonly executor: WorkflowStepExecutor;
  readonly maxConcurrentSteps: number;
  readonly allowedTools?: ReadonlySet<string>;
  readonly journal?: WorkflowJournal;
  readonly budget?: WorkflowTokenBudget;
  readonly defaultStepTokenEstimate?: number;
  readonly stallTimeoutMs?: number;
  readonly now?: () => number;
}

interface InFlightStep {
  readonly abort: AbortController;
  readonly startedAt: number;
  readonly reservationId: string | undefined;
  readonly estimate: number | undefined;
  readonly settledPromise: Promise<void>;
  readonly stallTimer: ReturnType<typeof setTimeout> | undefined;
  settled: boolean;
}

function requirePositiveInt(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error2(WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS, message, {
      details: { value },
    });
  }
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error2(
      WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS,
      `${field} must be a finite non-negative number.`,
      { details: { value } },
    );
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOutcome(outcome: WorkflowStepOutcome): WorkflowStepOutcome {
  if (outcome.tokensUsed !== undefined) {
    const tokens = outcome.tokensUsed;
    if (!Number.isFinite(tokens) || tokens < 0) {
      return { ok: false, error: 'executor reported an invalid tokensUsed value' };
    }
  }
  return outcome;
}

export class WorkflowRunner {
  private readonly script: WorkflowScript;
  private readonly executor: WorkflowStepExecutor;
  private readonly maxConcurrentSteps: number;
  private readonly allowedTools: ReadonlySet<string>;
  private readonly journal: WorkflowJournal;
  private readonly budget: WorkflowTokenBudget | undefined;
  private readonly defaultStepTokenEstimate: number | undefined;
  private readonly stallTimeoutMs: number | undefined;
  private readonly now: () => number;
  private readonly fingerprint: string;
  private readonly inFlight = new Map<string, InFlightStep>();
  private readonly completed = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly failedSteps: string[] = [];
  private readonly refusedSteps: string[] = [];
  private readonly skippedSteps: string[] = [];
  private runError: WorkflowRunError | undefined;
  private tokensUsed = 0;
  private active = false;

  constructor(options: WorkflowRunnerOptions) {
    if (typeof options.executor !== 'function') {
      throw new Error2(
        WorkflowErrors.codes.WORKFLOW_EXECUTOR_MISSING,
        'A workflow step executor must be provided; the runtime never executes steps itself.',
      );
    }
    requirePositiveInt(
      options.maxConcurrentSteps,
      'maxConcurrentSteps must be an integer of at least 1.',
    );
    if (options.defaultStepTokenEstimate !== undefined) {
      requireFiniteNonNegative(options.defaultStepTokenEstimate, 'defaultStepTokenEstimate');
    }
    if (options.stallTimeoutMs !== undefined) {
      requireFiniteNonNegative(options.stallTimeoutMs, 'stallTimeoutMs');
    }
    this.script = options.script;
    this.executor = options.executor;
    this.maxConcurrentSteps = options.maxConcurrentSteps;
    this.allowedTools = options.allowedTools ?? new Set<string>();
    this.journal = options.journal ?? new WorkflowJournal();
    this.budget = options.budget;
    this.defaultStepTokenEstimate = options.defaultStepTokenEstimate;
    this.stallTimeoutMs = options.stallTimeoutMs;
    this.now = options.now ?? (() => Date.now());
    this.fingerprint = workflowScriptFingerprint(options.script);
    for (const step of options.script.steps) this.pending.add(step.id);
  }

  get journalRef(): WorkflowJournal {
    return this.journal;
  }

  get scriptFingerprint(): string {
    return this.fingerprint;
  }

  get running(): boolean {
    return this.active;
  }

  async run(): Promise<WorkflowRunSummary> {
    if (this.active) {
      throw new Error2(
        WorkflowErrors.codes.WORKFLOW_ALREADY_RUNNING,
        `Workflow ${this.script.id} is already running.`,
        { details: { workflowId: this.script.id } },
      );
    }
    this.active = true;
    try {
      return await this.runLoop();
    } finally {
      this.active = false;
    }
  }

  private async runLoop(): Promise<WorkflowRunSummary> {
    const startedAt = this.now();
    const replay = this.journal.replay();
    this.assertScriptMatchesReplay(replay);
    for (const step of this.script.steps) {
      if (replay.steps.get(step.id)?.status === 'completed') {
        this.completed.add(step.id);
        this.pending.delete(step.id);
      }
    }

    if (this.journal.length > 0) {
      this.journal.append({ type: 'workflow.resumed', fromSeq: this.journal.length }, startedAt);
    } else {
      this.journal.append(
        { type: 'workflow.started', workflowId: this.script.id, fingerprint: this.fingerprint },
        startedAt,
      );
    }

    while (true) {
      if (this.runError === undefined) {
        for (const step of this.script.steps) {
          if (this.inFlight.size >= this.maxConcurrentSteps) break;
          if (!this.pending.has(step.id)) continue;
          if (!this.depsCompleted(step)) continue;
          this.launch(step);
          if (this.runError !== undefined) break;
        }
      }
      if (this.inFlight.size === 0) break;
      await Promise.race([...this.inFlight.values()].map((entry) => entry.settledPromise));
      for (const [stepId, entry] of [...this.inFlight]) {
        if (entry.settled) this.inFlight.delete(stepId);
      }
    }

    if (this.runError === undefined && this.pending.size > 0) {
      this.runError = {
        code: WorkflowErrors.codes.WORKFLOW_DEADLOCKED,
        message: `Workflow ${this.script.id} finished its launch loop with unrun steps remaining; this indicates a runner invariant violation.`,
      };
    }

    const endedAt = this.now();
    if (this.runError === undefined) {
      this.journal.append({ type: 'workflow.completed' }, endedAt);
    } else {
      for (const step of this.script.steps) {
        if (!this.pending.has(step.id)) continue;
        this.journal.append({ type: 'step.skipped', stepId: step.id }, endedAt);
        this.skippedSteps.push(step.id);
        this.pending.delete(step.id);
      }
      this.journal.append({ type: 'workflow.failed', reason: this.runError.code }, endedAt);
    }

    return {
      status: this.runError === undefined ? 'completed' : 'failed',
      workflowId: this.script.id,
      fingerprint: this.fingerprint,
      startedAt,
      endedAt,
      completed: [...this.completed],
      failed: [...this.failedSteps],
      refused: [...this.refusedSteps],
      skipped: [...this.skippedSteps],
      tokensUsed: this.tokensUsed,
      error: this.runError,
    };
  }

  private assertScriptMatchesReplay(replay: WorkflowReplayState): void {
    if (replay.workflowId !== undefined && replay.workflowId !== this.script.id) {
      throw new Error2(
        WorkflowErrors.codes.WORKFLOW_SCRIPT_MISMATCH,
        `Journal belongs to workflow ${replay.workflowId}, not ${this.script.id}.`,
        { details: { journalWorkflowId: replay.workflowId, workflowId: this.script.id } },
      );
    }
    if (replay.fingerprint !== undefined && replay.fingerprint !== this.fingerprint) {
      throw new Error2(
        WorkflowErrors.codes.WORKFLOW_SCRIPT_MISMATCH,
        'Journal fingerprint does not match the script; a resumed run must use the same script.',
        { details: { journalFingerprint: replay.fingerprint, fingerprint: this.fingerprint } },
      );
    }
  }

  private depsCompleted(step: WorkflowStep): boolean {
    if (step.dependsOn === undefined) return true;
    return step.dependsOn.every((dep) => this.completed.has(dep));
  }

  private launch(step: WorkflowStep): void {
    const at = this.now();
    if (!this.allowedTools.has(step.tool)) {
      this.journal.append({ type: 'step.refused', stepId: step.id, reason: 'tool-not-allowed' }, at);
      this.refusedSteps.push(step.id);
      this.pending.delete(step.id);
      this.failWorkflow({
        code: WorkflowErrors.codes.WORKFLOW_TOOL_NOT_ALLOWED,
        message: `Step ${step.id} uses tool ${step.tool}, which is not admitted for this workflow.`,
      });
      return;
    }

    let estimate: number | undefined;
    let reservationId: string | undefined;
    if (this.budget !== undefined) {
      const resolved = step.estimatedTokens ?? this.defaultStepTokenEstimate;
      if (resolved === undefined) {
        this.journal.append(
          { type: 'step.refused', stepId: step.id, reason: 'budget-estimate-missing' },
          at,
        );
        this.refusedSteps.push(step.id);
        this.pending.delete(step.id);
        this.failWorkflow({
          code: WorkflowErrors.codes.WORKFLOW_BUDGET_ESTIMATE_MISSING,
          message: `Step ${step.id} has no estimatedTokens and the runner has no defaultStepTokenEstimate; refusing to start without a budget reservation.`,
        });
        return;
      }
      try {
        const reservation = this.budget.reserve(this.script.id, { tokens: resolved });
        reservationId = reservation.id;
        estimate = resolved;
      } catch (error) {
        this.journal.append(
          { type: 'step.refused', stepId: step.id, reason: 'budget-exhausted' },
          at,
        );
        this.refusedSteps.push(step.id);
        this.pending.delete(step.id);
        this.failWorkflow({
          code: WorkflowErrors.codes.WORKFLOW_BUDGET_EXHAUSTED,
          message: `Budget refused the reservation for step ${step.id}: ${errorText(error)}`,
        });
        return;
      }
    }

    this.journal.append({ type: 'step.started', stepId: step.id }, at);
    this.pending.delete(step.id);

    const abort = new AbortController();
    let resolveSettled!: () => void;
    const settledPromise = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const stallTimer =
      this.stallTimeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.onStallTimeout(step.id);
          }, this.stallTimeoutMs);
    if (stallTimer !== undefined && typeof stallTimer === 'object' && 'unref' in stallTimer) {
      stallTimer.unref();
    }
    const entry: InFlightStep = {
      abort,
      startedAt: at,
      reservationId,
      estimate,
      settledPromise,
      stallTimer,
      settled: false,
    };
    this.inFlight.set(step.id, entry);

    void (async () => {
      let outcome: WorkflowStepOutcome;
      try {
        outcome = await this.executor(step, { signal: abort.signal });
      } catch (error) {
        outcome = { ok: false, error: errorText(error) };
      }
      if (this.inFlight.get(step.id) !== entry) return;
      if (entry.stallTimer !== undefined) clearTimeout(entry.stallTimer);
      this.settleStep(step, normalizeOutcome(outcome), entry);
      entry.settled = true;
      resolveSettled();
    })();
  }

  private settleStep(step: WorkflowStep, outcome: WorkflowStepOutcome, entry: InFlightStep): void {
    const at = this.now();
    if (outcome.ok) {
      const actual = outcome.tokensUsed ?? entry.estimate ?? 0;
      if (entry.reservationId !== undefined) {
        try {
          this.budget?.record(entry.reservationId, { tokens: actual });
        } catch (error) {
          this.budget?.release(entry.reservationId);
          this.tokensUsed += actual;
          this.completed.add(step.id);
          this.journal.append(
            {
              type: 'step.completed',
              stepId: step.id,
              tokensUsed: actual,
              summary: outcome.summary,
            },
            at,
          );
          this.failWorkflow({
            code: WorkflowErrors.codes.WORKFLOW_BUDGET_EXHAUSTED,
            message: `Settling step ${step.id} exceeded the token budget: ${errorText(error)}`,
          });
          return;
        }
      }
      this.tokensUsed += actual;
      this.journal.append(
        {
          type: 'step.completed',
          stepId: step.id,
          tokensUsed: actual,
          summary: outcome.summary,
        },
        at,
      );
      this.completed.add(step.id);
      return;
    }

    this.journal.append({ type: 'step.failed', stepId: step.id, error: outcome.error }, at);
    if (entry.reservationId !== undefined) this.budget?.release(entry.reservationId);
    if (outcome.tokensUsed !== undefined) this.tokensUsed += outcome.tokensUsed;
    this.failedSteps.push(step.id);
    this.failWorkflow({
      code: WorkflowErrors.codes.WORKFLOW_STEP_FAILED,
      message: `Step ${step.id} failed${outcome.error === undefined ? '.' : `: ${outcome.error}`}`,
    });
  }

  private onStallTimeout(stepId: string): void {
    const entry = this.inFlight.get(stepId);
    if (entry === undefined || entry.settled) return;
    const at = this.now();
    this.journal.append({ type: 'step.stalled', stepId, afterMs: at - entry.startedAt }, at);
    entry.abort.abort(
      new Error2(
        WorkflowErrors.codes.WORKFLOW_STALL_TIMEOUT,
        `Workflow step ${stepId} stalled for more than ${String(this.stallTimeoutMs)}ms.`,
        { details: { workflowId: this.script.id, stepId } },
      ),
    );
  }

  private failWorkflow(error: WorkflowRunError): void {
    if (this.runError !== undefined) return;
    this.runError = error;
  }
}
