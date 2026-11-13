import { describe, expect, it } from 'vitest';

import type { IAgentPermissionModeService } from '@hilbras/omnicode-engine/agent/permissionMode/permissionMode';
import type { IAgentTaskService } from '@hilbras/omnicode-engine/agent/task/task';
import type { IAgentToolPolicyService } from '@hilbras/omnicode-engine/agent/toolPolicy/toolPolicy';
import type { IConfigService } from '@hilbras/omnicode-engine/app/config/config';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { BashTool } from '#/os/bash/bashTool';
import { BashSandboxService, hostRestrictionDenialMessage } from '#/os/bash/sandbox';
import { createFakeProcessService, makeTestRuntime, type FakeGitCall } from '../../helpers/testRuntime';

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

function modeService(): IAgentPermissionModeService {
  return { mode: 'auto' } as IAgentPermissionModeService;
}

function bashTool(sandbox: BashSandboxService | undefined): {
  readonly tool: BashTool;
  readonly execute: (metadata: unknown) => Promise<ExecutableToolResult>;
} {
  const rt = makeTestRuntime({ workDir: '/workspace' });
  const tool = new BashTool(
    rt.runtimeService,
    rt.sessionCtx,
    rt.workspaceCtx,
    {} as IAgentTaskService,
    {} as IAgentToolPolicyService,
    {} as IConfigService,
    sandbox,
  );
  const execution = executable(tool.resolveExecution({ command: 'curl https://api.example.com' }));
  return {
    tool,
    execute: (metadata) => execution.execute({ ...rt.context, metadata }),
  };
}

function bashToolWithProcesses(sandbox: BashSandboxService): {
  readonly execute: () => Promise<ExecutableToolResult>;
  readonly calls: FakeGitCall[];
} {
  const calls: FakeGitCall[] = [];
  const rt = makeTestRuntime({
    workDir: '/workspace',
    process: createFakeProcessService(() => ({ stdout: '' }), calls),
  });
  const tasks = {
    registerTask: () => 'task-1',
    waitForForegroundRelease: async () => 'terminal',
    getTask: () => undefined,
    getOutputSnapshot: async () => ({ fullOutputAvailable: false }),
    persistOutput: () => {},
  } as unknown as IAgentTaskService;
  const toolPolicy = { isToolActive: () => false } as unknown as IAgentToolPolicyService;
  const config = { get: () => undefined } as unknown as IConfigService;
  const tool = new BashTool(rt.runtimeService, rt.sessionCtx, rt.workspaceCtx, tasks, toolPolicy, config, sandbox);
  const execution = executable(tool.resolveExecution({ command: 'echo hi' }));
  return { execute: () => execution.execute({ ...rt.context }), calls };
}

describe('BashTool exec-policy host amendment', () => {
  it('refuses to run a host-restricted command when no sandbox seam exists', async () => {
    const { execute } = bashTool(undefined);
    const result = await execute({ execPolicyAllowedHosts: ['api.example.com'] });
    expect(result.isError).toBe(true);
    expect(output(result)).toBe(hostRestrictionDenialMessage(['api.example.com']));
  });

  it('refuses a host-restricted command the sandbox service cannot confine', async () => {
    const sandbox = new BashSandboxService(modeService(), { mode: () => 'off' });
    const { execute } = bashTool(sandbox);
    const result = await execute({ execPolicyAllowedHosts: ['api.example.com'] });
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('api.example.com');
    expect(output(result)).toContain('exec policy');
  });

  it('names every restricted host in the refusal', async () => {
    const { execute } = bashTool(undefined);
    const result = await execute({
      execPolicyAllowedHosts: ['api.example.com', 'cdn.example.com'],
    });
    expect(output(result)).toContain('api.example.com, cdn.example.com');
  });
});

describe('BashTool sandbox fallback status', () => {
  it('records why an unavailable sandbox left the command unsandboxed', async () => {
    const sandbox = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => [
        {
          backend: 'bwrap',
          available: false,
          version: null,
          reason: 'bwrap not found',
          fallback: null,
          probes: [],
          checkedAt: 1,
        },
      ],
    });
    const { execute, calls } = bashToolWithProcesses(sandbox);
    const result = await execute();
    expect(output(result)).toContain('[sandbox] no OS sandbox backend is available');
    expect(calls[0]?.command).toBe('/bin/bash');
  });

  it('runs inside the sandbox plan without a fallback note when a backend is available', async () => {
    const sandbox = new BashSandboxService(modeService(), {
      mode: () => 'auto',
      probe: async () => [
        {
          backend: 'bwrap',
          available: true,
          version: '0.9.0',
          reason: null,
          fallback: null,
          probes: [],
          checkedAt: 1,
        },
      ],
    });
    const { execute, calls } = bashToolWithProcesses(sandbox);
    const result = await execute();
    expect(output(result)).not.toContain('[sandbox]');
    expect(calls[0]?.command).toBe('bwrap');
  });
});
