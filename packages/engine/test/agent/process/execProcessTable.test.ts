import { describe, expect, it } from 'vitest';

import {
  ExecProcessTable,
  clampYieldMs,
  DEFAULT_MAX_YIELD_MS,
  DEFAULT_MIN_YIELD_MS,
} from '#/agent/process/execProcessTable';

describe('clampYieldMs', () => {
  it('clamps zero, negative, fractional, huge and missing yields', () => {
    expect(clampYieldMs(undefined)).toBe(DEFAULT_MIN_YIELD_MS);
    expect(clampYieldMs(0)).toBe(DEFAULT_MIN_YIELD_MS);
    expect(clampYieldMs(-5)).toBe(DEFAULT_MIN_YIELD_MS);
    expect(clampYieldMs(75.9)).toBe(75);
    expect(clampYieldMs(12.9)).toBe(DEFAULT_MIN_YIELD_MS);
    expect(clampYieldMs(1_000_000)).toBe(DEFAULT_MAX_YIELD_MS);
    expect(clampYieldMs(Number.NaN)).toBe(DEFAULT_MIN_YIELD_MS);
  });
});

describe('ExecProcessTable', () => {
  it('registers, lists in start order and removes exited processes', () => {
    const table = new ExecProcessTable();
    table.register('b', 'npm test', 20, 1000);
    table.register('a', 'npm build', 10, 250);
    expect(table.list().map((p) => p.id)).toEqual(['a', 'b']);
    expect(table.get('a')?.yieldMs).toBe(250);
    expect(table.markExited('a')).toBe(true);
    expect(table.list().map((p) => p.id)).toEqual(['b']);
    expect(table.markExited('a')).toBe(false);
  });

  it('refuses duplicate ids', () => {
    const table = new ExecProcessTable();
    table.register('x', 'cmd', 1, 100);
    expect(() => table.register('x', 'other', 2, 100)).toThrow(/already registered/);
  });

  it('reports late-denied network approvals for kill follow-up', () => {
    const table = new ExecProcessTable();
    table.register('ok', 'curl a', 1, 100, 'granted');
    table.register('bad', 'curl b', 2, 100, 'denied');
    table.register('pending', 'curl c', 3, 100, 'pending');
    expect(table.lateDenied()).toEqual(['bad']);
  });

  it('renders a live-process section or nothing when idle', () => {
    const table = new ExecProcessTable();
    expect(table.renderSection()).toBeUndefined();
    table.register('w', 'watch', 1, 75, 'pending');
    expect(table.renderSection()).toContain('## Live Processes');
    expect(table.renderSection()).toContain('watch (yield 75ms, network pending)');
  });
});
