import { describe, expect, it } from 'vitest';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import type { ITelemetryService } from '@hilbras/omnicode-engine/app/telemetry/telemetry';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { GlobTool } from '#/os/glob/globTool';
import { createFakeProcessService, makeTestRuntime } from '../../helpers/testRuntime';

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

/** Only `stat` is on the Glob path; every other member is out of scope here. */
function fakeFileSystem(isDirectory: (path: string) => boolean | undefined): IHostFileSystem {
  return {
    _serviceBrand: undefined,
    stat: async (path: string) => {
      const isDir = isDirectory(path);
      if (isDir === undefined) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      return { isDirectory: isDir, isFile: !isDir, size: 0 } as never;
    },
  } as unknown as IHostFileSystem;
}

interface HarnessOptions {
  readonly isDirectory?: (path: string) => boolean | undefined;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly calls?: { command: string; args: readonly string[] }[];
}

/** Serves both the ripgrep availability probe and the `--files` run from one fake. */
function harness(options: HarnessOptions = {}) {
  const process = createFakeProcessService((call) => {
    options.calls?.push({ command: call.command, args: call.args });
    if (call.args.includes('--files')) {
      return {
        stdout: options.stdout ?? '',
        stderr: options.stderr ?? '',
        exitCode: options.exitCode ?? 0,
      };
    }
    // The availability probe only reads the exit code.
    return { stdout: 'ripgrep 14.1.0\n', exitCode: 0 };
  });
  const tr = makeTestRuntime({
    workDir: '/workspace',
    fs: fakeFileSystem(options.isDirectory ?? (() => true)),
    process,
  });
  const telemetry = { track2: () => {} } as unknown as ITelemetryService;
  return { tr, tool: new GlobTool(tr.runtimeService, tr.workspaceCtx, telemetry) };
}

async function runGlob(
  tool: GlobTool,
  args: Record<string, unknown>,
  tr: ReturnType<typeof harness>['tr'],
): Promise<ExecutableToolResult> {
  return executable(tool.resolveExecution(args as never)).execute(tr.context);
}

describe('GlobTool', () => {
  it('reports a missing search root instead of an empty result', async () => {
    const { tr, tool } = harness({ isDirectory: () => undefined });

    const result = await runGlob(tool, { pattern: '*.ts' }, tr);

    expect(result.isError).toBe(true);
    expect(output(result)).toBe('/workspace does not exist');
  });

  it('refuses a search root that is not a directory', async () => {
    const { tr, tool } = harness({ isDirectory: () => false });

    const result = await runGlob(tool, { pattern: '*.ts' }, tr);

    expect(result.isError).toBe(true);
    expect(output(result)).toContain('is not a directory');
  });

  it('lists matches relative to the workspace root', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const { tr, tool } = harness({
      stdout: 'src/a.ts\nb.ts\n',
      isDirectory: () => true,
      calls,
    });

    const result = await runGlob(tool, { pattern: '*.ts' }, tr);

    expect(result.isError).toBeUndefined();
    expect(output(result)).toContain('a.ts');
    expect(output(result)).toContain('b.ts');
    const fileRun = calls.find((call) => call.args.includes('--files'));
    expect(fileRun?.args).toContain('*.ts');
    expect(fileRun?.args).toContain('.');
  });

  it('says so when nothing matched', async () => {
    const { tr, tool } = harness({ stdout: '', exitCode: 1, isDirectory: () => true });

    const result = await runGlob(tool, { pattern: '*.nothing' }, tr);

    expect(result.isError).toBeUndefined();
    expect(output(result)).toContain('No matches found');
  });

  it('pages matches and tells the caller how to continue', async () => {
    const { tr, tool } = harness({
      stdout: 'a.ts\nb.ts\nc.ts\n',
      isDirectory: () => true,
    });

    const result = await runGlob(tool, { pattern: '*.ts', head_limit: 2 }, tr);
    const text = output(result);

    expect(text).toContain('Showing matches 1–2 of 3.');
    expect(text).toContain('offset=2');
  });

  it('surfaces a ripgrep failure with its reason', async () => {
    const { tr, tool } = harness({
      stdout: '',
      stderr: 'rg: error parsing glob',
      exitCode: 2,
      isDirectory: () => true,
    });

    const result = await runGlob(tool, { pattern: '[' }, tr);

    expect(result.isError).toBe(true);
  });

  it('filters secret files out of the results', async () => {
    const { tr, tool } = harness({
      stdout: 'src/a.ts\n.env\n.env.example\n',
      isDirectory: () => true,
    });

    const text = output(await runGlob(tool, { pattern: '*' }, tr));

    expect(text).toContain('src/a.ts');
    expect(text).toContain('.env.example');
    expect(text.split('\n')).not.toContain('.env');
    expect(text).not.toContain('/workspace/.env');
  });

  it('explains that only sensitive files matched', async () => {
    const { tr, tool } = harness({ stdout: '.env\n', isDirectory: () => true });

    const text = output(await runGlob(tool, { pattern: '*' }, tr));

    expect(text).toContain('No non-sensitive matches found (1 sensitive file(s) filtered).');
  });
});
