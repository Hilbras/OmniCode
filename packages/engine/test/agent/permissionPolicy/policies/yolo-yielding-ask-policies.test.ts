import { describe, expect, it } from 'vitest';

import type { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { GitControlPathAccessAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/git-control-path-access-ask';
import { SensitiveFileAccessAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/sensitive-file-access-ask';
import type { IBashParserService } from '#/app/bashParser/bashParser';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';

function modeService(mode: 'manual' | 'auto' | 'yolo'): IAgentPermissionModeService {
  return { mode } as unknown as IAgentPermissionModeService;
}

function bashContext(command: string): ResolvedToolExecutionHookContext {
  return {
    toolCall: { name: 'Bash' },
    args: { command },
    execution: {},
  } as unknown as ResolvedToolExecutionHookContext;
}

function fileAccessContext(path: string): ResolvedToolExecutionHookContext {
  return {
    toolCall: { name: 'Read' },
    args: { path },
    execution: { accesses: [{ kind: 'file', path, operation: 'read' }] },
  } as unknown as ResolvedToolExecutionHookContext;
}

describe('ask policies yield to yolo mode', () => {
  it('sensitive-file access asks in manual mode', () => {
    const policy = new SensitiveFileAccessAskPermissionPolicyService(
      { parse: () => ({ ok: false }) } as unknown as IBashParserService,
      modeService('manual'),
    );
    expect(policy.evaluate(bashContext('cat .env'))).toEqual({ kind: 'ask' });
  });

  it('sensitive-file access is skipped in yolo mode', () => {
    const policy = new SensitiveFileAccessAskPermissionPolicyService(
      { parse: () => ({ ok: false }) } as unknown as IBashParserService,
      modeService('yolo'),
    );
    expect(policy.evaluate(bashContext('cat .env'))).toBeUndefined();
    expect(policy.evaluate(fileAccessContext('/tmp/ws/.env'))).toBeUndefined();
  });

  it('git control path access asks in manual mode', async () => {
    const policy = new GitControlPathAccessAskPermissionPolicyService(
      {
        acquire: () => ({ runtime: { environment: { pathClass: 'posix' } }, dispose: () => {} }),
      } as never,
      { get workDir(): string { return '/tmp/ws'; } } as never,
      { findWorkTree: async () => ({ dotGitPath: '/tmp/ws/.git', controlDirPath: '/tmp/ws/.git' }) } as never,
      modeService('manual'),
    );
    expect(await policy.evaluate(fileAccessContext('/tmp/ws/.git/config'))).toEqual({ kind: 'ask' });
  });

  it('git control path access is skipped in yolo mode', async () => {
    const policy = new GitControlPathAccessAskPermissionPolicyService(
      {
        acquire: () => ({ runtime: { environment: { pathClass: 'posix' } }, dispose: () => {} }),
      } as never,
      { get workDir(): string { return '/tmp/ws'; } } as never,
      { findWorkTree: async () => ({ dotGitPath: '/tmp/ws/.git', controlDirPath: '/tmp/ws/.git' }) } as never,
      modeService('yolo'),
    );
    expect(await policy.evaluate(fileAccessContext('/tmp/ws/.git/config'))).toBeUndefined();
  });
});
