import { describe, expect, it } from 'vitest';

import { convertClaudeExtension } from '#/features/externalHooks/claudeExtensionConverter';

describe('convertClaudeExtension', () => {
  it('converts command groups into native hook definitions', () => {
    const result = convertClaudeExtension({
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo pre', timeout: 12 }],
        }],
        Stop: [{ hooks: [{ command: 'echo stop' }] }],
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.hooks).toEqual([
      { event: 'PreToolUse', command: 'echo pre', matcher: 'Bash', timeout: 12 },
      { event: 'Stop', command: 'echo stop' },
    ]);
  });

  it('clamps timeouts into the native range', () => {
    const result = convertClaudeExtension({
      hooks: { Stop: [{ hooks: [{ command: 'x', timeout: 9999 }] }] },
    });
    expect(result.hooks[0]?.timeout).toBe(600);
  });

  it('reports unsupported events and hook types instead of dropping them', () => {
    const result = convertClaudeExtension({
      hooks: {
        FutureEvent: [{ hooks: [{ command: 'x' }] }],
        Stop: [{ hooks: [{ type: 'prompt', command: 'y' }] }],
      },
    });
    expect(result.hooks).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.reason)).toEqual([
      'unsupported-event', 'unsupported-hook-type',
    ]);
  });

  it('reports a command hook without a command', () => {
    const result = convertClaudeExtension({
      hooks: { Stop: [{ hooks: [{ type: 'command' }] }] },
    });
    expect(result.diagnostics[0]?.reason).toBe('missing-command');
  });

  it('accepts an empty configuration', () => {
    expect(convertClaudeExtension({})).toEqual({ hooks: [], diagnostics: [] });
  });
});
