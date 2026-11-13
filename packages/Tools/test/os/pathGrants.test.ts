import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IFileEditService } from '@hilbras/omnicode-engine/app/edit/fileEdit';
import type { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import type { IAgentToolPolicyService } from '@hilbras/omnicode-engine/agent/toolPolicy/toolPolicy';
import type { IAgentToolRegistryService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolRegistry';
import type { IAgentToolResultTruncationService } from '@hilbras/omnicode-engine/agent/toolResultTruncation/toolResultTruncation';
import type { IConfigService } from '@hilbras/omnicode-engine/app/config/config';
import type { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';
import type { ISessionSkillCatalog } from '@hilbras/omnicode-engine/features/skill/session/skillCatalog';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { EditTool } from '#/edit/editTool';
import { LspTool } from '#/code-intelligence/lsp/lspTool';
import { checkSandboxReadPath, checkSandboxWritePath } from '#/os/sandbox/pathGrants';
import { ReadTool } from '#/os/read/readTool';
import { WriteTool } from '#/os/write/writeTool';
import { makeTestRuntime, type TestRuntime } from '../helpers/testRuntime';

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

const skillCatalog = {
  _serviceBrand: undefined,
  catalog: { getSkillRoots: () => [] },
} as unknown as ISessionSkillCatalog;

function readTool(rt: TestRuntime): ReadTool {
  return new ReadTool(
    rt.runtimeService,
    rt.workspaceCtx,
    skillCatalog,
    {} as unknown as IAgentToolResultTruncationService,
    {} as unknown as IConfigService,
    {} as unknown as IAgentProfileService,
    {} as unknown as IAgentToolPolicyService,
    {} as unknown as IAgentToolRegistryService,
    {} as unknown as IFlagService,
  );
}

describe('sandbox path grant checks', () => {
  it('allows everything when no grants are configured', () => {
    expect(checkSandboxWritePath('/workspace/src/a.ts', '/workspace', {})).toBeUndefined();
    expect(checkSandboxReadPath('/workspace/.env', '/workspace', {})).toBeUndefined();
  });

  it('denies writes outside the write allowlist', () => {
    const refusal = checkSandboxWritePath('/workspace/src/a.ts', '/workspace', {
      OMNICODE_SANDBOX_WRITE_ROOTS: '/workspace/out',
    });
    expect(refusal).toContain('write allowlist');
    expect(checkSandboxWritePath('/workspace/out/a.ts', '/workspace', {
      OMNICODE_SANDBOX_WRITE_ROOTS: '/workspace/out',
    })).toBeUndefined();
  });

  it('denies reads matching deny-read literals and globs', () => {
    const env = { OMNICODE_SANDBOX_DENY_READ: '/workspace/.env, /workspace/secrets/**' };
    expect(checkSandboxReadPath('/workspace/.env', '/workspace', env)).toContain('/workspace/.env');
    expect(checkSandboxReadPath('/workspace/secrets/key.pem', '/workspace', env)).toContain('/workspace/secrets/**');
    expect(checkSandboxReadPath('/workspace/.env.local', '/workspace', env)).toBeUndefined();
    expect(checkSandboxReadPath('/workspace/src/index.ts', '/workspace', env)).toBeUndefined();
  });

  it('fails closed when the configured allowlist is invalid', () => {
    const refusal = checkSandboxWritePath('/workspace/out/a.ts', '/workspace', {
      OMNICODE_SANDBOX_WRITE_ROOTS: '/elsewhere',
    });
    expect(refusal).toContain('sandbox policy is invalid');
  });

  it('fails closed on non-absolute entries instead of silently dropping them', () => {
    const whole = checkSandboxWritePath('/workspace/out/a.ts', '/workspace', {
      OMNICODE_SANDBOX_WRITE_ROOTS: 'relative/path',
    });
    expect(whole).toContain('OMNICODE_SANDBOX_WRITE_ROOTS must contain absolute paths');
    expect(whole).toContain('relative/path');

    const mixed = checkSandboxWritePath('/workspace/out/a.ts', '/workspace', {
      OMNICODE_SANDBOX_WRITE_ROOTS: '/workspace/out, typo',
    });
    expect(mixed).toContain('rejected: typo');

    const deny = checkSandboxReadPath('/workspace/src/a.ts', '/workspace', {
      OMNICODE_SANDBOX_DENY_READ: 'secrets',
    });
    expect(deny).toContain('OMNICODE_SANDBOX_DENY_READ must contain absolute paths');
    expect(deny).toContain('secrets');
  });

  it('treats an empty or blank value as unconfigured', () => {
    expect(checkSandboxWritePath('/workspace/a.ts', '/workspace', {
      OMNICODE_SANDBOX_WRITE_ROOTS: ' , ',
    })).toBeUndefined();
    expect(checkSandboxReadPath('/workspace/a.ts', '/workspace', {
      OMNICODE_SANDBOX_DENY_READ: '   ',
    })).toBeUndefined();
  });
});

describe('tool-level sandbox grant enforcement', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses a Write outside the write allowlist', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_WRITE_ROOTS', '/workspace/out');
    const rt = makeTestRuntime({ workDir: '/workspace' });
    const tool = new WriteTool(rt.runtimeService, rt.workspaceCtx, skillCatalog);
    const execution = executable(tool.resolveExecution({ path: '/workspace/src/a.txt', content: 'hi' }));
    const result = await execution.execute({ ...rt.context });
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('write allowlist');
  });

  it('refuses an Edit outside the write allowlist', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_WRITE_ROOTS', '/workspace/out');
    const rt = makeTestRuntime({ workDir: '/workspace' });
    const tool = new EditTool({} as unknown as IFileEditService, rt.runtimeService, rt.workspaceCtx, skillCatalog);
    const execution = executable(
      tool.resolveExecution({ path: '/workspace/src/a.txt', old_string: 'a', new_string: 'b' }),
    );
    const result = await execution.execute({ ...rt.context });
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('write allowlist');
  });

  it('refuses a Read matching a deny-read entry', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_DENY_READ', '/workspace/proprietary/**');
    const rt = makeTestRuntime({ workDir: '/workspace' });
    const execution = executable(await readTool(rt).resolveExecution({ path: '/workspace/proprietary/data.json' }));
    const result = await execution.execute({ ...rt.context });
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('/workspace/proprietary/**');
  });

  it('refuses an Lsp query on a deny-read file', async () => {
    vi.stubEnv('OMNICODE_SANDBOX_DENY_READ', '/workspace/proprietary/**');
    const rt = makeTestRuntime({ workDir: '/workspace' });
    const tool = new LspTool(rt.runtimeService, rt.workspaceCtx, skillCatalog);
    const execution = executable(
      tool.resolveExecution({ path: '/workspace/proprietary/app.py', action: 'symbols' }),
    );
    const result = await execution.execute({ ...rt.context });
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('/workspace/proprietary/**');
  });
});
