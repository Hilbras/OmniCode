import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { HostFileSystem } from '@hilbras/omnicode-engine/os/backends/node-local/hostFsService';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  SessionRecordStore,
  sha256,
  sourceLines,
  sourceLocation,
} from '#/records/recordStore';
import { ArtifactRecordTool, SourceRecordTool } from '#/records/recordTools';
import { makeTestRuntime } from '../helpers/testRuntime';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-records-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

const provenance = {
  sessionId: 'session-test',
  agentId: 'agent-test',
  origin: 'agent-tool' as const,
};

describe('record store', () => {
  it('hashes content deterministically', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
    expect(sha256('hello')).not.toBe(sha256('hello!'));
  });

  it('splits source lines without counting a trailing newline as a line', () => {
    expect(sourceLines('')).toEqual([]);
    expect(sourceLines('a\nb\n')).toEqual(['a', 'b']);
    expect(sourceLines('a\n\n')).toEqual(['a', '']);
  });

  it('slices source line ranges with bounded metadata', () => {
    const located = sourceLocation('/repo/a.ts', ['a', 'b', 'c', 'd'], 2, 3);
    expect(located.content).toBe('b\nc');
    expect(located.source).toEqual({
      path: '/repo/a.ts',
      startLine: 2,
      endLine: 3,
      totalLines: 4,
    });
    expect(() => sourceLocation('/repo/a.ts', ['a'], 2, 3)).toThrow('Invalid line range');
  });

  it('writes bounded content and provenance under the session directory', async () => {
    const dir = await tempDir();
    const store = new SessionRecordStore(
      new HostFileSystem(),
      dir,
      () => 'fixed-id',
      () => 123,
    );
    const saved = await store.save({
      kind: 'artifact',
      name: 'notes',
      content: 'x'.repeat(50),
      maxChars: 10,
      provenance,
    });
    expect(saved.record.truncated).toBe(true);
    expect(saved.record.storedChars).toBe(10);
    expect(saved.record.createdAt).toBe(123);
    expect(saved.record.provenance).toEqual(provenance);
    expect(saved.relativePath).toBe('artifacts/artifact-fixed-id.json');
    const persisted = JSON.parse(await readFile(saved.path, 'utf8')) as {
      record: { name: string };
      content: string;
    };
    expect(persisted.record.name).toBe('notes');
    expect(persisted.content.length).toBe(10);
  });

  it('rejects invalid record ids and names', async () => {
    const dir = await tempDir();
    const fs = new HostFileSystem();
    const badId = new SessionRecordStore(fs, dir, () => '../escape');
    await expect(
      badId.save({ kind: 'artifact', name: 'x', content: 'x', maxChars: 10, provenance }),
    ).rejects.toThrow('invalid characters');
    const store = new SessionRecordStore(fs, dir);
    await expect(
      store.save({ kind: 'artifact', name: '', content: 'x', maxChars: 10, provenance }),
    ).rejects.toThrow('Record name');
  });
});

describe('record tools', () => {
  it('records artifact content with provenance', async () => {
    const dir = await tempDir();
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new ArtifactRecordTool(tr.runtimeService, tr.sessionCtx, tr.scopeCtx);
    const result = await executable(
      tool.resolveExecution({ name: 'summary', content: 'artifact body', media_type: 'text/plain' }),
    ).execute(tr.context);
    expect(result.isError).toBeFalsy();
    expect(output(result)).toContain('artifacts/artifact-');
    expect(output(result)).toContain('"toolCallId": "call-test"');
    const names = await readdir(join(dir, 'artifacts'));
    expect(names).toHaveLength(1);
    const persisted = JSON.parse(await readFile(join(dir, 'artifacts', names[0]!), 'utf8')) as {
      record: { provenance: { sessionId: string; agentId: string } };
    };
    expect(persisted.record.provenance).toMatchObject({
      sessionId: 'session-test',
      agentId: 'agent-test',
    });
  });

  it('records a source excerpt and validates line ranges', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.ts'), 'line1\nline2\nline3\nline4\n', 'utf8');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new SourceRecordTool(
      tr.runtimeService,
      tr.sessionCtx,
      tr.scopeCtx,
      tr.workspaceCtx,
    );
    const result = await executable(
      tool.resolveExecution({ path: 'a.ts', start_line: 2, end_line: 3 }),
    ).execute(tr.context);
    expect(result.isError).toBeFalsy();
    expect(output(result)).toContain('"startLine": 2');
    expect(output(result)).toContain('"endLine": 3');
    const names = await readdir(join(dir, 'sources'));
    expect(names).toHaveLength(1);
    const persisted = JSON.parse(await readFile(join(dir, 'sources', names[0]!), 'utf8')) as {
      content: string;
    };
    expect(persisted.content).toBe('line2\nline3');

    const invalid = await executable(
      tool.resolveExecution({ path: 'a.ts', start_line: 9, end_line: 10 }),
    ).execute(tr.context);
    expect(invalid.isError).toBe(true);
  });

  it('reports missing source files', async () => {
    const dir = await tempDir();
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new SourceRecordTool(
      tr.runtimeService,
      tr.sessionCtx,
      tr.scopeCtx,
      tr.workspaceCtx,
    );
    const result = await executable(tool.resolveExecution({ path: 'missing.ts' })).execute(
      tr.context,
    );
    expect(result.isError).toBe(true);
  });
});
