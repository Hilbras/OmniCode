import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import type { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';
import { HostFileSystem } from '@hilbras/omnicode-engine/os/backends/node-local/hostFsService';
import type { IAgentFileHistoryService } from '@hilbras/omnicode-engine/features/fileHistory/fileHistory';
import { MAIN_AGENT_ID } from '@hilbras/omnicode-engine/session/agentLifecycle/agentLifecycle';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { RestoreFileTool } from '#/restore-file/restoreFileTool';
import { makeTestRuntime } from '../helpers/testRuntime';

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

function restoreTool(
  tr: ReturnType<typeof makeTestRuntime>,
  turns: readonly { turnId: number; changes: readonly { path: string }[] }[],
): RestoreFileTool {
  const fileHistory = {
    turns: async () => turns,
  } as unknown as IAgentFileHistoryService;
  const agentCtx = { _serviceBrand: undefined, agentId: MAIN_AGENT_ID } as unknown as IAgentScopeContext;
  const flags = { enabled: () => true } as unknown as IFlagService;
  return new RestoreFileTool(tr.runtimeService, agentCtx, tr.workspaceCtx, fileHistory, flags);
}

describe('RestoreFileTool sandbox write grants', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses when an explicit target is outside the write allowlist', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_WRITE_ROOTS', '/workspace/out');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: '/workspace' });
    const tool = restoreTool(tr, [
      { turnId: 1, changes: [{ path: '/workspace/src/a.ts' }] },
    ]);
    const execution = executable(tool.resolveExecution({ paths: ['/workspace/src/a.ts'] }));
    const result = await execution.execute(tr.context);
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('sandbox policy denies a write target');
    expect(output(result)).toContain('/workspace/src/a.ts');
  });

  it('refuses a full-turn restore when the turn touched a denied path', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_WRITE_ROOTS', '/workspace/out');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: '/workspace' });
    const tool = restoreTool(tr, [
      {
        turnId: 1,
        changes: [
          { path: '/workspace/out/kept.ts' },
          { path: '/workspace/src/denied.ts' },
        ],
      },
    ]);
    const execution = executable(tool.resolveExecution({}));
    const result = await execution.execute(tr.context);
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('/workspace/src/denied.ts');
  });

  it('restores normally when every candidate holds a write grant', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_WRITE_ROOTS', '/workspace/src');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: '/workspace' });
    const restore = vi.fn(async () => ({ files: [], restored: 0, skipped: 0 }));
    const fileHistory = {
      turns: async () => [{ turnId: 1, changes: [{ path: '/workspace/src/a.ts' }] }],
      restore,
    } as unknown as IAgentFileHistoryService;
    const agentCtx = { _serviceBrand: undefined, agentId: MAIN_AGENT_ID } as unknown as IAgentScopeContext;
    const flags = { enabled: () => true } as unknown as IFlagService;
    const tool = new RestoreFileTool(tr.runtimeService, agentCtx, tr.workspaceCtx, fileHistory, flags);
    const execution = executable(tool.resolveExecution({ paths: ['/workspace/src/a.ts'] }));
    const result = await execution.execute(tr.context);
    expect(result.isError).toBeFalsy();
    expect(restore).toHaveBeenCalledWith(1, ['/workspace/src/a.ts'], { force: false });
  });
});
