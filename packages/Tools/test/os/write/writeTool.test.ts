import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { WriteTool } from '#/os/write/writeTool';
import { makeTestRuntime } from '../../helpers/testRuntime';

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

interface WriteRecord {
  readonly kind: 'write' | 'append' | 'mkdir';
  readonly path: string;
  readonly data?: string;
}

interface HarnessOptions {
  readonly existingDirs?: readonly string[];
  readonly parentIsFile?: boolean;
  readonly mkdirFails?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const records: WriteRecord[] = [];
  const dirs = new Set<string>(options.existingDirs ?? ['/workspace']);
  const fs = {
    _serviceBrand: undefined,
    stat: async (path: string) => {
      if (options.parentIsFile === true && path === '/workspace/dir') {
        return { isDirectory: false, isFile: true, size: 0, mtimeMs: 0 } as never;
      }
      if (!dirs.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      return { isDirectory: true, isFile: false, size: 0, mtimeMs: 0 } as never;
    },
    mkdir: async (path: string) => {
      if (options.mkdirFails === true) throw new Error('EACCES: permission denied, mkdir');
      records.push({ kind: 'mkdir', path });
      dirs.add(path);
    },
    writeText: async (path: string, data: string) => {
      records.push({ kind: 'write', path, data });
    },
    appendText: async (path: string, data: string) => {
      records.push({ kind: 'append', path, data });
    },
  } as unknown as IHostFileSystem;

  const tr = makeTestRuntime({ workDir: '/workspace', fs });
  return { tr, tool: new WriteTool(tr.runtimeService, tr.workspaceCtx), records };
}

async function runWrite(
  tool: WriteTool,
  args: Record<string, unknown>,
  tr: ReturnType<typeof harness>['tr'],
): Promise<ExecutableToolResult> {
  return executable(tool.resolveExecution(args as never)).execute(tr.context);
}

describe('WriteTool', () => {
  let lockDir: string;

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), 'omnicode-write-tool-lock-'));
    vi.stubEnv('OMNICODE_WRITE_LOCK_DIR', lockDir);
  });

  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('writes content and reports the byte count', async () => {
    const { tr, tool, records } = harness();

    const result = await runWrite(tool, { path: 'a.txt', content: 'hello' }, tr);

    expect(result.isError).toBeFalsy();
    expect(output(result)).toBe('Wrote 5 bytes to a.txt');
    expect(records).toEqual([{ kind: 'write', path: '/workspace/a.txt', data: 'hello' }]);
  });

  it('appends without adding a newline', async () => {
    const { tr, tool, records } = harness();

    const result = await runWrite(tool, { path: 'a.txt', content: 'more', mode: 'append' }, tr);

    expect(output(result)).toBe('Appended 4 bytes to a.txt');
    expect(records).toEqual([{ kind: 'append', path: '/workspace/a.txt', data: 'more' }]);
  });

  it('creates missing parent directories before writing', async () => {
    const { tr, tool, records } = harness();

    await runWrite(tool, { path: 'nested/deep/a.txt', content: 'x' }, tr);

    expect(records.map((record) => record.kind)).toEqual(['mkdir', 'write']);
    expect(records[0]?.path).toBe('/workspace/nested/deep');
  });

  it('refuses a parent path that is a file', async () => {
    const { tr, tool, records } = harness({ existingDirs: ['/workspace', '/workspace/dir'], parentIsFile: true });

    const result = await runWrite(tool, { path: 'dir/a.txt', content: 'x' }, tr);

    expect(result.isError).toBe(true);
    expect(output(result)).toContain('Parent path is not a directory: /workspace/dir.');
    expect(records).toEqual([]);
  });

  it('surfaces a failed directory creation instead of writing anyway', async () => {
    const { tr, tool, records } = harness({ mkdirFails: true });

    const result = await runWrite(tool, { path: 'nested/a.txt', content: 'x' }, tr);

    expect(result.isError).toBe(true);
    expect(output(result)).toContain('EACCES');
    expect(records).toEqual([]);
  });
});
