import { describe, expect, it, vi } from 'vitest';

import type { IConfigService } from '#/app/config/config';
import type { IBootstrapService } from '#/app/bootstrap/bootstrap';
import type { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ExecPolicyWriterService } from '#/agent/permissionPolicy/execPolicy/execPolicyWriter';
import { loadExecPolicy } from '#/agent/permissionPolicy/execPolicy/execPolicy';
import { ExecPolicyPersistenceService } from '#/agent/permissionPolicy/execPolicy/execPolicyPersistenceService';

function compose(options: { path?: string; file?: string } = {}) {
  let written = '';
  const config = {
    get: () => (options.path === undefined ? undefined : { path: options.path }),
  } as unknown as IConfigService;
  const bootstrap = { homeDir: '/home/user', osHomeDir: '/home/user' } as IBootstrapService;
  const fs = {
    readText: async () => options.file ?? JSON.stringify({ version: 1, rules: [] }),
    writeText: async (_path: string, text: string) => {
      written = text;
    },
  } as unknown as IHostFileSystem;
  return { service: new ExecPolicyWriterService(config, bootstrap, fs), written: () => written };
}

describe('ExecPolicyWriterService', () => {
  it('appends an allow prefix for a simple command', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    const result = await service.appendAllowPrefix('git status --short');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.added).toBe(true);
    const policy = JSON.parse(written()) as { rules: { prefix: string[]; decision: string }[] };
    expect(policy.rules.at(-1)).toMatchObject({
      prefix: ['git', 'status', '--short'],
      decision: 'allow',
    });
  });

  it('pins a match example and a not-match probe on every persisted rule', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('git status');
    const policy = JSON.parse(written()) as {
      rules: { examples: { command: string; matches: boolean }[] }[];
    };
    expect(policy.rules.at(-1)?.examples).toEqual([
      { command: 'git status', matches: true },
      { command: 'git statusx', matches: false },
    ]);
  });

  it('persists the suggested narrow prefix when one is provided', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('git log -5', { prefix: ['git', 'log'], display: 'git log *' });
    const policy = JSON.parse(written()) as {
      rules: { prefix: string[]; examples: { command: string; matches: boolean }[] }[];
    };
    expect(policy.rules.at(-1)?.prefix).toEqual(['git', 'log']);
    expect(policy.rules.at(-1)?.examples).toEqual([
      { command: 'git log -5', matches: true },
      { command: 'git logx', matches: false },
    ]);
  });

  it('suggested rules validate at load, including the anti-broadening probe', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('git log -5', { prefix: ['git', 'log'], display: 'git log *' });
    const file = JSON.parse(written()) as Parameters<typeof loadExecPolicy>[0];
    expect(() => loadExecPolicy(file, 'exec-policy.json')).not.toThrow();

    // A later hand-broadening of the persisted prefix (git log → git) makes
    // the not-match probe match, so the file fails at load instead of
    // silently allowing more than the user approved.
    const broadened = JSON.parse(written()) as { rules: { prefix: string[] }[] };
    broadened.rules[broadened.rules.length - 1]!.prefix = ['git'];
    expect(() => loadExecPolicy(broadened, 'exec-policy.json')).toThrow(
      /matches but is marked not-matching/,
    );
  });

  it('treats a later approval under the same rule as a duplicate', async () => {
    const file = JSON.stringify({
      version: 1,
      rules: [{ prefix: ['git', 'log'], decision: 'allow' }],
    });
    const { service, written } = compose({ path: 'exec-policy.json', file });
    const result = await service.appendAllowPrefix('git log --oneline', {
      prefix: ['git', 'log'],
      display: 'git log *',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.added).toBe(false);
    expect(written()).toBe('');
  });

  it('ignores a suggestion that is not a prefix of the approved command', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('git log -5', {
      prefix: ['rg'],
      display: 'rg *',
    });
    const policy = JSON.parse(written()) as { rules: { prefix: string[] }[] };
    expect(policy.rules.at(-1)?.prefix).toEqual(['git', 'log', '-5']);
  });

  it('writes examples that survive load-time validation', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('git status --short');
    const file = JSON.parse(written()) as Parameters<typeof loadExecPolicy>[0];
    expect(() => loadExecPolicy(file, 'exec-policy.json')).not.toThrow();
  });

  it('the not-match probe catches a later hand-broadened prefix at load', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('git status');
    const broadened = JSON.parse(written()) as {
      rules: { prefix: string[] }[];
    };
    // A later hand-edit widens the approved rule from `git status` to `git`.
    broadened.rules[broadened.rules.length - 1]!.prefix = ['git'];
    expect(() => loadExecPolicy(broadened, 'exec-policy.json')).toThrow(/matches but is marked not-matching/);
  });

  it('pins examples for single-token prefixes without a not-match false positive', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('rg');
    const file = JSON.parse(written()) as Parameters<typeof loadExecPolicy>[0];
    expect(() => loadExecPolicy(file, 'exec-policy.json')).not.toThrow();
    const policy = JSON.parse(written()) as {
      rules: { examples: { command: string; matches: boolean }[] }[];
    };
    expect(policy.rules.at(-1)?.examples).toEqual([
      { command: 'rg', matches: true },
      { command: 'rgx', matches: false },
    ]);
  });

  it('unwraps a shell wrapper before writing the prefix', async () => {
    const { service, written } = compose({ path: 'exec-policy.json' });
    await service.appendAllowPrefix('/bin/bash -lc "git status"');
    const policy = JSON.parse(written()) as { rules: { prefix: string[] }[] };
    expect(policy.rules.at(-1)?.prefix).toEqual(['git', 'status']);
  });

  it('does not duplicate an existing allow prefix', async () => {
    const file = JSON.stringify({
      version: 1,
      rules: [{ prefix: ['git', 'status'], decision: 'allow' }],
    });
    const { service, written } = compose({ path: 'exec-policy.json', file });
    const result = await service.appendAllowPrefix('git status');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.added).toBe(false);
    expect(written()).toBe('');
  });

  it('refuses an opaque command', async () => {
    const { service } = compose({ path: 'exec-policy.json' });
    const result = await service.appendAllowPrefix('echo hi | sh');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('simple invocation');
  });

  it('refuses when no policy path is configured', async () => {
    const { service } = compose();
    const result = await service.appendAllowPrefix('git status');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no exec policy path');
  });
});

describe('ExecPolicyPersistenceService', () => {
  function compose() {
    let handler: ((event: unknown) => void) | undefined;
    const appendAllowPrefix = vi.fn(async () => ({ ok: true as const, path: '/p', added: true }));
    const eventBus = {
      subscribe: (_type: unknown, next: (event: unknown) => void) => {
        handler = next;
        return { dispose: () => undefined };
      },
    };
    const log = { child: () => ({ info: vi.fn() }) };
    const service = new ExecPolicyPersistenceService(
      eventBus as never,
      { appendAllowPrefix } as never,
      log as never,
    );
    return { service, handler: () => handler, appendAllowPrefix };
  }

  it('writes a rule for an approved-always Bash command', () => {
    const { handler, appendAllowPrefix } = compose();
    handler()?.({
      decision: 'approved',
      scope: 'always',
      display: { kind: 'command', command: 'git status' },
    });
    expect(appendAllowPrefix).toHaveBeenCalledWith('git status', undefined);
  });

  it('passes the display-suggested rule to the writer', () => {
    const { handler, appendAllowPrefix } = compose();
    const suggestedRule = { prefix: ['git', 'log'], display: 'git log *' };
    handler()?.({
      decision: 'approved',
      scope: 'always',
      display: { kind: 'command', command: 'git log -5', suggestedRule },
    });
    expect(appendAllowPrefix).toHaveBeenCalledWith('git log -5', suggestedRule);
  });

  it('ignores session approvals and non-command displays', () => {
    const { handler, appendAllowPrefix } = compose();
    handler()?.({ decision: 'approved', scope: 'session', display: { kind: 'command', command: 'git status' } });
    handler()?.({
      decision: 'approved',
      scope: 'always',
      display: { kind: 'file_io', operation: 'read', path: '/a' },
    });
    expect(appendAllowPrefix).not.toHaveBeenCalled();
  });
});
