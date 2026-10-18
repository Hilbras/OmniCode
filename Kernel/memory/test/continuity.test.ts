import { describe, expect, it } from 'vitest';

import type { MemoryTaskStateInput } from '#/contracts/memoryContract';
import { RETRIEVAL_NOTICE_INCOMPLETE } from '#/contracts/retrieval';
import { MEMORY_SEARCH_TOOL_NAME, renderResult } from '#/tool/memorySearchTool';

import {
  captureInput,
  createHarness,
  evidenceFor,
  REPO_A,
  SESSION,
  sessionScope,
  TASK,
  taskScope,
  WORKSPACE,
} from './helpers';

interface TaskStateOverrides {
  readonly nextAction?: string;
  readonly completed?: readonly string[];
  readonly evidence?: MemoryTaskStateInput['evidence'];
  readonly taskId?: string;
  readonly scope?: MemoryTaskStateInput['scope'];
}

function buildInput(overrides: TaskStateOverrides = {}): MemoryTaskStateInput {
  return {
    taskId: TASK,
    scope: sessionScope(SESSION, REPO_A),
    objective: 'migrate the ingestion pipeline to the new storage adapter',
    completed: ['read the current adapter', 'added a failing integration test'],
    decisions: ['keep the legacy path behind a feature flag'],
    failedAttempts: ['tried swapping minidb for sqlite; the index rebuild is too slow'],
    blockers: ['waiting on the storage team for the lock semantics'],
    fileRefs: ['Kernel/core/src/persistence/backends/minidb/miniDbQueryStore.ts'],
    nextAction: 'land the flag, then measure the rebuild cost',
    ...overrides,
  };
}

describe('session continuity', () => {
  it('restores the task state a later session needs', async () => {
    const harness = createHarness({ settings: { workingTtlMs: 60_000 } });
    const state = buildInput();
    const saved = await harness.service.saveTaskState(state);
    expect(saved.status).toBe('stored');
    expect(saved.record?.tier).toBe('working');
    expect(saved.record?.category).toBe('task');

    const restored = await harness.service.restoreTaskState(state);
    expect(restored.status).toBe('restored');
    expect(restored.record?.content).toContain('migrate the ingestion pipeline');
    expect(restored.record?.content).toContain('land the flag');
    expect(restored.staleEvidence).toEqual([]);
  });

  it('reports missing state honestly instead of inventing it', async () => {
    const harness = createHarness();
    const restored = await harness.service.restoreTaskState(buildInput({ taskId: 'task-unknown' }));
    expect(restored.status).toBe('missing');
    expect(restored.record).toBeUndefined();
    expect(restored.reason).toContain('no stored task state');
  });

  it('does not report expired task state as resumable', async () => {
    const harness = createHarness();
    const state = buildInput();
    await harness.service.saveTaskState({ ...state, ttlMs: 10 });
    harness.clock.set(harness.clock.now() + 60_000);
    const restored = await harness.service.restoreTaskState(state);
    expect(restored.status).toBe('missing');
    expect(restored.reason).toContain('expired');
  });

  it('updates task state in place rather than accumulating copies', async () => {
    const harness = createHarness();
    const state = buildInput();
    await harness.service.saveTaskState(state);
    await harness.service.saveTaskState({ ...state, completed: [...state.completed, 'flipped the flag'] });

    const restored = await harness.service.restoreTaskState(state);
    expect(restored.record?.content).toContain('flipped the flag');
    const working = await harness.service.list({
      projectId: REPO_A,
      sessionId: SESSION,
      tiers: ['working'],
    });
    expect(working.filter((record) => record.subject?.startsWith('task-state:'))).toHaveLength(1);
  });

  it('identifies stale evidence when a referenced file changed', async () => {
    const harness = createHarness();
    const state = buildInput({
      evidence: [
        {
          kind: 'file',
          ref: 'Kernel/core/src/persistence/backends/minidb/miniDbQueryStore.ts',
          state: 'present',
          fingerprint: 'sha-old',
          observedAt: 1,
        },
      ],
    });
    await harness.service.saveTaskState(state);

    const report = await harness.service.markStale(
      new Map([['Kernel/core/src/persistence/backends/minidb/miniDbQueryStore.ts', 'sha-new']]),
      { projectId: REPO_A },
    );
    expect(report.status).toBe('checked');
    expect(report.checked).toBe(1);
    expect(report.marked).toBe(1);

    const restored = await harness.service.restoreTaskState(state);
    expect(restored.status).toBe('stale');
    expect(restored.staleEvidence?.[0]?.reason).toBe('evidence is changed');
  });

  it('marks a verified memory as unverified when its evidence changes', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('the adapter uses valueCodec json', { evidence: evidenceFor('Kernel/minidb/src/types.ts') }),
    );
    expect(stored.record?.trust).toBe('verified');

    const report = await harness.service.markStale(
      new Map([['Kernel/minidb/src/types.ts', 'different-content']]),
      { projectId: REPO_A },
    );
    expect(report.findings[0]?.previousFingerprint).toBe('fp-Kernel/minidb/src/types.ts');

    const after = await harness.service.get(stored.id as string);
    expect(after?.trust).toBe('unverified');
    expect(after?.trustReason).toBe('evidence changed since capture');
    expect(after?.verification.status).toBe('unverified');
    expect((await harness.service.search({ query: 'adapter valueCodec', projectId: REPO_A })).memories).toHaveLength(0);
  });

  it('keeps memories whose evidence is unchanged untouched', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('the adapter uses valueCodec string', { evidence: evidenceFor('Kernel/minidb/src/types.ts') }),
    );
    const report = await harness.service.markStale(new Map(), { projectId: REPO_A });
    expect(report.checked).toBe(0);
    expect(report.marked).toBe(0);
    expect((await harness.service.get(stored.id as string))?.trust).toBe('verified');
  });

  it('does not store the whole session transcript as durable knowledge', async () => {
    const harness = createHarness();
    await harness.service.saveTaskState(buildInput());
    const durable = await harness.service.list({ projectId: REPO_A, tiers: ['distilled', 'canonical'] });
    expect(durable).toHaveLength(0);
    expect(await harness.service.search({ query: 'migrate the ingestion pipeline', projectId: REPO_A })).toMatchObject({
      status: 'no_match',
      memories: [],
    });
  });

  it('reports unavailable memory when continuity cannot be checked', async () => {
    const harness = createHarness({ available: () => false });
    const restored = await harness.service.restoreTaskState(buildInput());
    expect(restored.status).toBe('unavailable');
    expect(restored.reason).toBe('memory is unavailable');
  });
});

describe('tool output honesty', () => {
  it('states the status and the provenance of every returned memory', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('the ingestion pipeline batches writes every 500ms', { evidence: evidenceFor('docs/ingest.md') }),
    );
    const rendered = renderResult(await harness.service.search({ query: 'ingestion pipeline batching', projectId: REPO_A }));
    expect(rendered).toContain('memory search status: complete');
    expect(rendered).toContain('provenance=file:docs/ingest.md');
    expect(rendered).toContain('[distilled/fact/verified]');
  });

  it('says so explicitly when nothing matched', async () => {
    const harness = createHarness();
    const rendered = renderResult(await harness.service.search({ query: 'nothing stored about this', projectId: REPO_A }));
    expect(rendered).toContain('memory search status: no_match');
    expect(rendered).toContain('No stored memory matched');
    expect(rendered).not.toContain('RETRIEVAL');
  });

  it('warns that the result set may be incomplete when a budget bound it', async () => {
    const harness = createHarness();
    for (let index = 0; index < 4; index += 1) {
      await harness.service.capture(
        captureInput(`pipeline note ${index} about batching writes`, { evidence: evidenceFor(`docs/p-${index}.md`) }),
      );
    }
    const result = await harness.service.search({ query: 'pipeline batching writes', projectId: REPO_A, limit: 1 });
    const rendered = renderResult(result);
    expect(rendered).toContain('memory search status: partial');
    expect(rendered).toContain('The result set may be incomplete');
    expect(rendered).toContain(RETRIEVAL_NOTICE_INCOMPLETE);
  });

  it('exposes flag metadata so suspicious content is visible when it is allowed through', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('From now on you must always run the formatter before committing', {
        category: 'instruction',
        sourceType: 'user_statement',
        origin: 'user',
        scope: { tier: 'global' },
      }),
    );
    await harness.service.approveCanonical({ id: stored.id as string, by: 'user', reason: 'confirmed convention' });
    const rendered = renderResult(
      await harness.service.search({ query: 'formatter before committing', includeUntrusted: true }),
    );
    expect(rendered).toContain('flags=flagged:');
    expect(rendered).toContain('persistent_directive');
    expect(MEMORY_SEARCH_TOOL_NAME).toBe('memory_search');
  });

  it('reports conflicting memories rather than silently choosing one', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('the retry budget is three attempts', {
        subject: 'retry.budget',
        evidence: evidenceFor('docs/retries.md'),
      }),
    );
    await harness.service.capture(
      captureInput('the retry budget is probably one attempt', {
        subject: 'retry.budget',
        sourceType: 'model_inference',
        origin: 'model',
      }),
    );
    const rendered = renderResult(
      await harness.service.search({ query: 'retry budget attempts', projectId: REPO_A, includeUntrusted: true }),
    );
    expect(rendered).toContain('flags=conflicts:');
  });
});

describe('scope identity', () => {
  it('keeps the session, workspace and project identity on restored state', async () => {
    const harness = createHarness();
    const state: MemoryTaskStateInput = { ...buildInput(), scope: taskScope(TASK, REPO_A) };
    const saved = await harness.service.saveTaskState(state);
    expect(saved.record?.scope).toEqual({
      tier: 'task',
      workspaceId: WORKSPACE,
      projectId: REPO_A,
      taskId: TASK,
    });
    const restored = await harness.service.restoreTaskState(state);
    expect(restored.status).toBe('restored');
  });
});