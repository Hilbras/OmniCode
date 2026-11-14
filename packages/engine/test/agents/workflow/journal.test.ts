import { describe, expect, it } from 'vitest';

import { WorkflowErrors } from '#/agents/runtime/workflow/errors';
import {
  WorkflowJournal,
  collectStalledSteps,
  parseWorkflowJournalEntries,
  replayWorkflowJournal,
  type WorkflowJournalEntry,
} from '#/agents/runtime/workflow/journal';

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

function entriesOf(values: Array<Record<string, unknown>>): unknown[] {
  return values;
}

describe('workflow journal entries', () => {
  it('validates restored entries and requires contiguous sequence from 1', () => {
    expect(parseWorkflowJournalEntries(entriesOf([]))).toEqual([]);
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(
          entriesOf([{ seq: 2, at: 0, type: 'workflow.completed' }]),
        ),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(
          entriesOf([
            { seq: 1, at: 0, type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' },
            { seq: 1, at: 0, type: 'workflow.completed' },
          ]),
        ),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(entriesOf([{ seq: 1, at: 0, type: 'alien.event' }])),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(
          entriesOf([
            { seq: 1, at: 0, type: 'step.started', stepId: 'a' },
            { seq: 2, at: 0, type: 'step.completed' },
          ]),
        ),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(
          entriesOf([{ seq: 1, at: Number.NaN, type: 'workflow.completed' }]),
        ),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
  });

  it('rejects a well-formed journal that never started its workflow', () => {
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(
          entriesOf([{ seq: 1, at: 0, type: 'workflow.resumed', fromSeq: 0 }]),
        ),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
    expect(
      thrownCode(() =>
        parseWorkflowJournalEntries(
          entriesOf([{ seq: 1, at: 0, type: 'step.started', stepId: 'a' }]),
        ),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
    expect(
      parseWorkflowJournalEntries(entriesOf([])),
    ).toEqual([]);
  });

  it('replays step and workflow state from entries', () => {
    const entries = parseWorkflowJournalEntries(
      entriesOf([
        { seq: 1, at: 10, type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' },
        { seq: 2, at: 11, type: 'step.started', stepId: 'a' },
        { seq: 3, at: 12, type: 'step.completed', stepId: 'a', tokensUsed: 7, summary: 'ok' },
        { seq: 4, at: 13, type: 'step.started', stepId: 'b' },
        { seq: 5, at: 14, type: 'step.stalled', stepId: 'b', afterMs: 500 },
        { seq: 6, at: 15, type: 'step.failed', stepId: 'b', error: 'boom' },
        { seq: 7, at: 16, type: 'step.refused', stepId: 'c', reason: 'tool-not-allowed' },
        { seq: 8, at: 17, type: 'step.skipped', stepId: 'd' },
        { seq: 9, at: 18, type: 'workflow.failed', reason: 'workflow.step_failed' },
      ]),
    );
    const state = replayWorkflowJournal(entries);
    expect(state.workflowId).toBe('wf');
    expect(state.fingerprint).toBe('fp');
    expect(state.startedAt).toBe(10);
    expect(state.terminal).toBe('failed');
    expect(state.terminalReason).toBe('workflow.step_failed');
    expect(state.endedAt).toBe(18);
    expect(state.steps.get('a')).toMatchObject({
      status: 'completed',
      startedAt: 11,
      endedAt: 12,
      tokensUsed: 7,
      summary: 'ok',
    });
    expect(state.steps.get('b')).toMatchObject({ status: 'failed', error: 'boom', stalled: true });
    expect(state.steps.get('c')).toMatchObject({
      status: 'refused',
      refusedReason: 'tool-not-allowed',
    });
    expect(state.steps.get('d')).toMatchObject({ status: 'skipped' });
  });

  it('clears the terminal marker on resume', () => {
    const entries = parseWorkflowJournalEntries(
      entriesOf([
        { seq: 1, at: 10, type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' },
        { seq: 2, at: 11, type: 'workflow.failed', reason: 'workflow.step_failed' },
        { seq: 3, at: 12, type: 'workflow.resumed', fromSeq: 2 },
      ]),
    );
    const state = replayWorkflowJournal(entries);
    expect(state.terminal).toBeUndefined();
    expect(state.terminalReason).toBeUndefined();
  });
});

describe('WorkflowJournal', () => {
  it('appends with contiguous sequence numbers and continues after restore', () => {
    const journal = new WorkflowJournal();
    const started = journal.append(
      { type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' },
      10,
    );
    const stepStart = journal.append({ type: 'step.started', stepId: 'a' }, 11);
    expect(started.seq).toBe(1);
    expect(stepStart.seq).toBe(2);
    expect(journal.length).toBe(2);
    expect(journal.nextSeq).toBe(3);

    const restored = new WorkflowJournal({ entries: journal.read() });
    expect(restored.length).toBe(2);
    const completed = restored.append(
      { type: 'step.completed', stepId: 'a', tokensUsed: 3 },
      12,
    );
    expect(completed.seq).toBe(3);
    expect(restored.read()[2]).toMatchObject({ seq: 3, at: 12, stepId: 'a', tokensUsed: 3 });
  });

  it('refuses a corrupt restored journal instead of silently trusting it', () => {
    expect(
      thrownCode(
        () =>
          new WorkflowJournal({
            entries: [{ seq: 2, at: 0, type: 'workflow.completed' }] as WorkflowJournalEntry[],
          }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
  });

  it('refuses a restored journal that never started its workflow', () => {
    expect(
      thrownCode(
        () =>
          new WorkflowJournal({
            entries: [{ seq: 1, at: 0, type: 'workflow.resumed', fromSeq: 0 }],
          }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID);
  });

  it('builds checkpoints from the current sequence and state', () => {
    const journal = new WorkflowJournal();
    journal.append({ type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' }, 1);
    journal.append({ type: 'step.started', stepId: 'a' }, 2);
    journal.append({ type: 'step.completed', stepId: 'a', tokensUsed: 5 }, 3);
    const checkpoint = journal.checkpoint();
    expect(checkpoint.seq).toBe(3);
    expect(checkpoint.state.terminal).toBeUndefined();
    expect(checkpoint.state.steps.get('a')).toMatchObject({ status: 'completed' });
    const after = journal.append({ type: 'workflow.completed' }, 4);
    expect(after.seq).toBe(4);
    expect(journal.checkpoint().state.terminal).toBe('completed');
  });
});

describe('collectStalledSteps', () => {
  it('reports running steps past the window and skips finished ones', () => {
    const entries = parseWorkflowJournalEntries(
      entriesOf([
        { seq: 1, at: 0, type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' },
        { seq: 2, at: 0, type: 'step.started', stepId: 'slow' },
        { seq: 3, at: 10, type: 'step.started', stepId: 'recent' },
        { seq: 4, at: 0, type: 'step.started', stepId: 'done' },
        { seq: 5, at: 5, type: 'step.completed', stepId: 'done', tokensUsed: 1 },
      ]),
    );
    const stalled = collectStalledSteps(replayWorkflowJournal(entries), {
      stallTimeoutMs: 50,
      now: 60,
    });
    expect(stalled).toEqual(['slow', 'recent']);
  });

  it('reports nothing when every running step is inside the window', () => {
    const entries = parseWorkflowJournalEntries(
      entriesOf([
        { seq: 1, at: 0, type: 'workflow.started', workflowId: 'wf', fingerprint: 'fp' },
        { seq: 2, at: 45, type: 'step.started', stepId: 'a' },
      ]),
    );
    const stalled = collectStalledSteps(replayWorkflowJournal(entries), {
      stallTimeoutMs: 50,
      now: 60,
    });
    expect(stalled).toEqual([]);
  });

  it('rejects an invalid window', () => {
    expect(
      thrownCode(() =>
        collectStalledSteps(replayWorkflowJournal([]), { stallTimeoutMs: -1, now: 0 }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS);
    expect(
      thrownCode(() =>
        collectStalledSteps(replayWorkflowJournal([]), {
          stallTimeoutMs: Number.POSITIVE_INFINITY,
          now: 0,
        }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS);
  });
});
