import { describe, expect, it } from 'vitest';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import type { ITelemetryService } from '@hilbras/omnicode-engine/app/telemetry/telemetry';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { GrepTool } from '#/os/grep/grepTool';
import { createFakeProcessService, makeTestRuntime } from '../../helpers/testRuntime';

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

/** `rg --null` puts a NUL after the path, then the payload up to the newline. */
function record(filePath: string, payload: string): string {
  return `${filePath}\0${payload}\n`;
}

function newlineDelimitedFile(filePath: string): string {
  return record(filePath, '');
}

function fakeFileSystem(mtimeMs = 1_700_000_000_000): IHostFileSystem {
  return {
    _serviceBrand: undefined,
    stat: async () => ({ isDirectory: false, isFile: true, size: 0, mtimeMs }) as never,
  } as unknown as IHostFileSystem;
}

interface HarnessOptions {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly calls?: { command: string; args: readonly string[] }[];
}

function harness(options: HarnessOptions = {}) {
  const process = createFakeProcessService((call) => {
    options.calls?.push({ command: call.command, args: call.args });
    if (call.args.includes('--null')) {
      return {
        stdout: options.stdout ?? '',
        stderr: options.stderr ?? '',
        exitCode: options.exitCode ?? 0,
      };
    }
    return { stdout: 'ripgrep 14.1.0\n', exitCode: 0 };
  });
  const tr = makeTestRuntime({ workDir: '/workspace', fs: fakeFileSystem(), process });
  const telemetry = { track2: () => {} } as unknown as ITelemetryService;
  return { tr, tool: new GrepTool(tr.runtimeService, tr.workspaceCtx, telemetry) };
}

async function runGrep(
  tool: GrepTool,
  args: Record<string, unknown>,
  tr: ReturnType<typeof harness>['tr'],
): Promise<ExecutableToolResult> {
  return executable(tool.resolveExecution(args as never)).execute(tr.context);
}

describe('GrepTool', () => {
  it('returns content matches relative to the workspace', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const { tr, tool } = harness({
      stdout: record('/workspace/src/a.ts', '12:const x = 1;'),
      calls,
    });

    const result = await runGrep(tool, { pattern: 'const x', output_mode: 'content' }, tr);

    expect(result.isError).toBe(false);
    expect(output(result)).toContain('src/a.ts:12:const x = 1;');
    const run = calls.find((call) => call.args.includes('--null'));
    expect(run?.args).toContain('--with-filename');
    expect(run?.args).toContain('const x');
  });

  it('lists matching files in the default mode', async () => {
    const { tr, tool } = harness({
      stdout: newlineDelimitedFile('/workspace/src/a.ts') + newlineDelimitedFile('/workspace/b.ts'),
    });

    const text = output(await runGrep(tool, { pattern: 'needle' }, tr));

    expect(text).toContain('src/a.ts');
    expect(text).toContain('b.ts');
  });

  it('summarises counts in count mode', async () => {
    const { tr, tool } = harness({ stdout: record('/workspace/src/a.ts', '3') });

    const text = output(await runGrep(tool, { pattern: 'needle', output_mode: 'count_matches' }, tr));

    expect(text).toContain('src/a.ts:3');
    expect(text).toContain('Found 3 total occurrences across 1 file.');
  });

  it('reports no matches without an error', async () => {
    const { tr, tool } = harness({ stdout: '', exitCode: 1 });

    const result = await runGrep(tool, { pattern: 'needle', output_mode: 'content' }, tr);

    expect(result.isError).toBe(false);
    expect(output(result)).toContain('No matches found');
  });

  it('says filtering hid everything only when filtering actually happened', async () => {
    const { tr, tool } = harness({ stdout: record('/workspace/.env', '1:API_KEY=secret') });

    const text = output(await runGrep(tool, { pattern: 'API_KEY', output_mode: 'content' }, tr));

    expect(text).toContain('No non-sensitive matches found');
    expect(text).toContain('Filtered 1 sensitive file(s): .env');
    expect(text).not.toContain('API_KEY=secret');
  });

  it('surfaces a ripgrep failure with its reason', async () => {
    const { tr, tool } = harness({ stdout: '', stderr: 'rg: regex parse error', exitCode: 2 });

    const result = await runGrep(tool, { pattern: '(', output_mode: 'content' }, tr);

    expect(result.isError).toBe(true);
    expect(output(result)).toContain('regex parse error');
  });

  it('filters sensitive files and says which ones', async () => {
    const { tr, tool } = harness({
      stdout: record('/workspace/.env', '1:API_KEY=secret') + record('/workspace/src/a.ts', '2:hit'),
    });

    const text = output(await runGrep(tool, { pattern: 'hit', output_mode: 'content' }, tr));

    expect(text).toContain('src/a.ts:2:hit');
    expect(text).toContain('Filtered 1 sensitive file(s): .env');
  });

  it('pages content matches and tells the caller how to continue', async () => {
    const { tr, tool } = harness({
      stdout: record('/workspace/a.ts', '1:one') + record('/workspace/a.ts', '2:two'),
    });

    const text = output(
      await runGrep(tool, { pattern: 'one|two', output_mode: 'content', head_limit: 1 }, tr),
    );

    expect(text).toContain('Results truncated to 1 lines (total: 2). Use offset=1 to see more.');
  });
});