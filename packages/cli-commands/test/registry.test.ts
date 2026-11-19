import { describe, expect, it } from 'vitest';

import {
  CommandRegistry,
  createCommandRegistry,
  normalizeName,
  type CommandDefinition,
} from '../src/index.js';

function command(name: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return { name, description: `${name} description`, ...overrides };
}

describe('normalizeName', () => {
  it('trims, strips leading slashes and lowercases', () => {
    expect(normalizeName('  /Model  ')).toBe('model');
    expect(normalizeName('EXIT')).toBe('exit');
    expect(normalizeName('/')).toBe('');
  });
});

describe('CommandRegistry registration', () => {
  it('rejects duplicate names and aliases', () => {
    const registry = createCommandRegistry([command('model', { aliases: ['m'] })]);
    expect(() => registry.register(command('model'))).toThrow(/already registered/);
    expect(() => registry.register(command('other', { aliases: ['m'] }))).toThrow(
      /alias already registered/,
    );
  });

  it('resolves aliases and ignores empty aliases', () => {
    const registry = createCommandRegistry([command('model', { aliases: ['', '/m', 'modelx'] })]);
    expect(registry.resolveName('/M')).toBe('model');
    expect(registry.resolveName('modelx')).toBe('model');
    expect(registry.get('model')?.name).toBe('model');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('unregister removes the command and its aliases', () => {
    const registry = createCommandRegistry([command('model', { aliases: ['m'] })]);
    expect(registry.unregister('m')).toBe(true);
    expect(registry.get('model')).toBeUndefined();
    expect(registry.unregister('m')).toBe(false);
  });
});

describe('CommandRegistry listing and completion', () => {
  it('orders by priority descending, then name', () => {
    const registry = createCommandRegistry([
      command('beta', { priority: 1 }),
      command('alpha', { priority: 1 }),
      command('top', { priority: 10 }),
    ]);
    expect(registry.list().map((item) => item.name)).toEqual(['top', 'alpha', 'beta']);
  });

  it('filters hidden and disabled commands unless asked to include them', () => {
    const registry = createCommandRegistry([
      command('shown'),
      command('secret', { hidden: true }),
      command('off', { enabled: false }),
    ]);
    expect(registry.list().map((item) => item.name)).toEqual(['shown']);
    expect(registry.list({ includeHidden: true }).map((item) => item.name)).toEqual([
      'secret', 'shown',
    ]);
    expect(registry.list({ includeDisabled: true }).map((item) => item.name)).toEqual([
      'off', 'shown',
    ]);
  });

  it('completes names by prefix and forwards argument completion', () => {
    const registry = createCommandRegistry([
      command('model', { description: 'pick a model', completeArgs: () => [{ value: 'k2' }] }),
      command('memory'),
    ]);
    expect(registry.complete('mo').map((item) => item.value)).toEqual(['/model']);
    expect(registry.completeArguments('model', '')).toEqual([{ value: 'k2' }]);
    expect(registry.completeArguments('memory', '')).toBeNull();
  });
});

describe('CommandRegistry execution', () => {
  it('executes enabled handlers and reports unknown, disabled and handlerless commands', async () => {
    const registry = new CommandRegistry();
    registry.register(command('ok', { execute: (args) => ({ ok: true, data: args }) }));
    registry.register(command('off', { enabled: false, execute: () => ({ ok: true }) }));
    registry.register(command('bare'));
    const context = { cwd: '/tmp' };
    expect(await registry.execute('ok', 'x', context)).toEqual({ ok: true, data: 'x' });
    expect((await registry.execute('missing', '', context)).message).toMatch(/Unknown command/);
    expect((await registry.execute('off', '', context)).message).toMatch(/Command disabled/);
    expect((await registry.execute('bare', '', context)).message).toMatch(/no handler/);
  });
});
