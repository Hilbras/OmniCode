import { describe, expect, it } from 'vitest';

import {
  WorldStateTracker,
  applyWorldStateDelta,
  asWorldState,
  diffWorldState,
  isDeltaEmpty,
  renderUndiffableFallback,
  renderWorldState,
} from '#/agent/contextProjector/worldState';

describe('asWorldState', () => {
  it('accepts flat typed values and rejects nested or non-finite ones', () => {
    expect(asWorldState({ a: 1, b: 'x', c: true, d: null, e: ['x', 'y'] })).toEqual({
      a: 1,
      b: 'x',
      c: true,
      d: null,
      e: ['x', 'y'],
    });
    expect(asWorldState({ a: { nested: 1 } })).toBeUndefined();
    expect(asWorldState({ a: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(asWorldState([1, 2])).toBeUndefined();
    expect(asWorldState('s')).toBeUndefined();
  });
});

describe('diffWorldState / applyWorldStateDelta', () => {
  it('reports added, changed, and removed keys', () => {
    const delta = diffWorldState({ a: 1, b: 'x', c: true }, { a: 2, b: 'x', d: 'new' });
    expect(delta).toEqual({ a: 2, c: null, d: 'new' });
  });

  it('round-trips: baseline + delta equals next', () => {
    const baseline = { a: 1, b: ['x'], c: null };
    const next = { a: 1, b: ['x', 'y'] };
    expect(applyWorldStateDelta(baseline, diffWorldState(baseline, next))).toEqual(next);
  });

  it('treats an unchanged state as an empty delta', () => {
    expect(isDeltaEmpty(diffWorldState({ a: [1 as never] }, { a: [1 as never] }))).toBe(true);
  });
});

describe('WorldStateTracker', () => {
  it('emits a full render first, then deltas', () => {
    const tracker = new WorldStateTracker();
    expect(tracker.next({ goal: 'g' })).toEqual({ kind: 'full', state: { goal: 'g' } });
    expect(tracker.next({ goal: 'g', todo: 't' })).toEqual({
      kind: 'delta',
      delta: { todo: 't' },
    });
  });

  it('forces a full render after resetBaseline (compaction)', () => {
    const tracker = new WorldStateTracker();
    tracker.next({ a: 1 });
    tracker.next({ a: 2 });
    tracker.resetBaseline();
    expect(tracker.next({ a: 2 })).toEqual({ kind: 'full', state: { a: 2 } });
  });

  it('periodically re-renders in full so drift cannot accumulate', () => {
    const tracker = new WorldStateTracker({ maxDeltasBeforeFull: 2 });
    tracker.next({ a: 1 });
    expect(tracker.next({ a: 2 }).kind).toBe('delta');
    expect(tracker.next({ a: 3 }).kind).toBe('delta');
    expect(tracker.next({ a: 4 }).kind).toBe('full');
  });

  it('keeps the baseline version stable across deltas', () => {
    const tracker = new WorldStateTracker();
    tracker.next({ a: 1 });
    const version = tracker.currentBaseline()?.version;
    tracker.next({ a: 2 });
    expect(tracker.currentBaseline()?.version).toBe(version);
  });
});

describe('rendering', () => {
  it('renders full and delta sections', () => {
    expect(renderWorldState({ kind: 'full', state: { goal: 'ship' } })).toContain('- goal: ship');
    expect(renderWorldState({ kind: 'delta', delta: { goal: null, todo: 'x' } })).toContain(
      '- goal: (removed)',
    );
    expect(renderWorldState({ kind: 'delta', delta: {} })).toContain('(no changes)');
  });

  it('falls back to a full render for undiffable state', () => {
    expect(renderUndiffableFallback({ nested: { deep: 1 } })).toEqual({
      kind: 'full',
      state: { unrenderable: 'object' },
    });
    expect(renderUndiffableFallback(42)).toEqual({ kind: 'full', state: { unrenderable: 'number' } });
  });
});

describe('projector world-state integration', () => {
  it('seeds a full render, emits deltas, and resets after compaction', async () => {
    const { AgentContextProjectorService } = await import('#/agent/contextProjector/contextProjectorService');
    const service = new AgentContextProjectorService(
      { warn: () => {} } as never,
      { track2: () => {} } as never,
      { contributeState: () => {}, get: () => null, set: () => {} } as never,
    );
    expect(service.renderWorldState({ goal: 'ship' })).toEqual({
      kind: 'full',
      state: { goal: 'ship' },
    });
    expect(service.renderWorldState({ goal: 'ship', todo: 'x' })).toEqual({
      kind: 'delta',
      delta: { todo: 'x' },
    });
    service.resetWorldStateBaseline();
    expect(service.worldStateText({ goal: 'ship', todo: 'x' })).toContain('- goal: ship');
  });
});
