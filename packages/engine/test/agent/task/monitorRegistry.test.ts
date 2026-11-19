import { describe, expect, it } from 'vitest';

import {
  MonitorRegistry,
  formatTaskNotification,
  DEFAULT_MONITOR_INTERVAL_MS,
  DEFAULT_MONITOR_MAX_LINES,
} from '#/agent/task/monitorRegistry';

describe('MonitorRegistry', () => {
  it('clamps interval and line caps at registration', () => {
    const registry = new MonitorRegistry();
    expect(registry.register({ id: 'a', source: 'npm test' })).toEqual({
      id: 'a', source: 'npm test',
      intervalMs: DEFAULT_MONITOR_INTERVAL_MS, maxLines: DEFAULT_MONITOR_MAX_LINES,
    });
    expect(registry.register({ id: 'b', source: 'x', intervalMs: -5, maxLines: 9999 }).maxLines).toBe(2_000);
    expect(registry.get('b')?.intervalMs).toBe(250);
  });

  it('refuses duplicate ids and stops cleanly', () => {
    const registry = new MonitorRegistry();
    registry.register({ id: 'a', source: 'x' });
    expect(() => registry.register({ id: 'a', source: 'y' })).toThrow(/already registered/);
    expect(registry.stop('a')).toBe(true);
    expect(registry.stop('a')).toBe(false);
  });

  it('caps buffered lines and reports drops in the idle envelope', () => {
    const registry = new MonitorRegistry();
    registry.register({ id: 'watch', source: 'tail -f log', maxLines: 2 });
    for (let index = 0; index < 5; index += 1) registry.record('watch', `line ${String(index)}`);

    const [envelope] = registry.drainIdleNotifications();
    expect(envelope).toContain('<task-notification watch="watch">');
    expect(envelope).toContain('line 4');
    expect(envelope).toContain('3 line(s) dropped');
    expect(registry.drainIdleNotifications()).toEqual([]);
  });

  it('ignores lines for unknown watchers and truncates very long lines', () => {
    const registry = new MonitorRegistry();
    expect(() => registry.record('missing', 'x')).not.toThrow();
    registry.register({ id: 'a', source: 'x', maxLines: 1 });
    registry.record('a', 'z'.repeat(5_000));
    expect(registry.drainIdleNotifications()[0]).toContain('z'.repeat(2_000));
  });

  it('formats an honest notification envelope', () => {
    expect(formatTaskNotification({ watchId: 'w', text: 'ok', droppedLines: 0 })).toBe(
      '<task-notification watch="w">\nok\n</task-notification>',
    );
  });
});
