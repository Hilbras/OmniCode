import { describe, expect, it } from 'vitest';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import type { ITelemetryService } from '@hilbras/omnicode-engine/app/telemetry/telemetry';
import type { IConfigService } from '@hilbras/omnicode-engine/app/config/config';
import type { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import type { IAgentToolPolicyService } from '@hilbras/omnicode-engine/agent/toolPolicy/toolPolicy';
import type { IAgentToolRegistryService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolRegistry';
import type { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';
import type { ISessionSkillCatalog } from '@hilbras/omnicode-engine/features/skill/session/skillCatalog';
import type { IAgentToolResultTruncationService } from '@hilbras/omnicode-engine/agent/toolResultTruncation/toolResultTruncation';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { ReadTool } from '#/os/read/readTool';
import { createFakeProcessService, makeTestRuntime } from '../../helpers/testRuntime';

function executable(
  execution: ToolExecution | Promise<ToolExecution>,
): Promise<Extract<ToolExecution, { execute: unknown }>> {
  return Promise.resolve(execution).then((resolved) => {
    if (!('execute' in resolved)) throw new Error('expected an executable tool result');
    return resolved;
  });
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

function fileSystemWith(files: Record<string, string>): IHostFileSystem {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
  return {
    _serviceBrand: undefined,
    stat: async (path: string) => {
      const text = files[path];
      if (text === undefined) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      return { isDirectory: false, isFile: true, size: encode(text).length, mtimeMs: 0 } as never;
    },
    readBytes: async (path: string, n?: number, offset?: number) => {
      const text = files[path];
      if (text === undefined) {
        const error = new Error(`ENOENT: no such file or directory, read '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      const bytes = encode(text);
      return bytes.slice(offset ?? 0, n === undefined ? undefined : (offset ?? 0) + n);
    },
    readLines: (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file or directory, read '${path}'`);
      return (async function* lines() {
        for (const line of text.split('\n')) yield line;
      })();
    },
  } as unknown as IHostFileSystem;
}

function harness(files: Record<string, string>) {
  const tr = makeTestRuntime({
    workDir: '/workspace',
    fs: fileSystemWith(files),
    process: createFakeProcessService(() => ({ exitCode: 0 })),
  });
  const tool = new ReadTool(
    tr.runtimeService,
    tr.workspaceCtx,
    { catalog: { getSkillRoots: () => [] } } as unknown as ISessionSkillCatalog,
    { isWireJournalPath: () => false } as unknown as IAgentToolResultTruncationService,
    { get: () => undefined } as unknown as IConfigService,
    { getModelCapabilities: () => ({}) } as unknown as IAgentProfileService,
    { isToolActive: () => false } as unknown as IAgentToolPolicyService,
    { resolve: () => undefined } as unknown as IAgentToolRegistryService,
    { enabled: () => false } as unknown as IFlagService,
    undefined,
  );
  return { tr, tool };
}

async function runRead(
  tool: ReadTool,
  args: Record<string, unknown>,
  tr: ReturnType<typeof harness>['tr'],
): Promise<ExecutableToolResult> {
  const execution = await executable(tool.resolveExecution(args as never));
  return execution.execute(tr.context);
}

const TELEMETRY = { track2: () => {} } as unknown as ITelemetryService;
void TELEMETRY;

describe('ReadTool', () => {
  it('returns a text file with numbered lines', async () => {
    const { tr, tool } = harness({ '/workspace/a.txt': 'one\ntwo\nthree\n' });

    const result = await runRead(tool, { path: 'a.txt' }, tr);

    expect(result.isError).toBeFalsy();
    const text = output(result);
    expect(text).toContain('1\tone');
    expect(text).toContain('2\ttwo');
    expect(text).toContain('3\tthree');
  });

  it('reads a window of lines', async () => {
    const { tr, tool } = harness({ '/workspace/a.txt': 'one\ntwo\nthree\nfour\n' });

    const text = output(await runRead(tool, { path: 'a.txt', line_offset: 2, n_lines: 2 }, tr));

    expect(text).toContain('two');
    expect(text).toContain('three');
    expect(text).not.toContain('four');
  });

  it('reads the tail of a file', async () => {
    // No trailing newline: a trailing one adds an empty final line, which would
    // make "the last two lines" include that empty line instead of `three`.
    const { tr, tool } = harness({ '/workspace/a.txt': 'one\ntwo\nthree\nfour' });

    const text = output(await runRead(tool, { path: 'a.txt', line_offset: -2 }, tr));

    expect(text).toContain('three');
    expect(text).toContain('four');
    expect(text).not.toContain('one');
  });

  it('reports a missing file instead of an empty read', async () => {
    const { tr, tool } = harness({});

    const result = await runRead(tool, { path: 'missing.txt' }, tr);

    expect(result.isError).toBe(true);
    expect(output(result)).toContain('missing.txt');
  });
});
