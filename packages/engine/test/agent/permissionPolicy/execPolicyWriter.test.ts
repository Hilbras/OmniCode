import { describe, expect, it, vi } from 'vitest';

import type { IConfigService } from '#/app/config/config';
import type { IBootstrapService } from '#/app/bootstrap/bootstrap';
import type { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ExecPolicyWriterService } from '#/agent/permissionPolicy/execPolicy/execPolicyWriter';
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
    expect(appendAllowPrefix).toHaveBeenCalledWith('git status');
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
