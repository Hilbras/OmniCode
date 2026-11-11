import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { HostFileSystem } from '@hilbras/omnicode-engine/os/backends/node-local/hostFsService';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  deleteNotebookCell,
  insertNotebookCell,
  parseNotebook,
  replaceNotebookCell,
  serializeNotebook,
  summarizeNotebook,
} from '#/notebook/notebook';
import { NotebookEditTool } from '#/notebook/notebookTool';
import { makeTestRuntime } from '../helpers/testRuntime';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-notebook-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sampleNotebook(): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      { cell_type: 'markdown', source: ['# Title'], metadata: {} },
      { cell_type: 'code', source: 'print(1)', metadata: {}, execution_count: null, outputs: [] },
    ],
  });
}

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

describe('notebook pure helpers', () => {
  it('parses and serializes nbformat 4 notebooks', () => {
    const document = parseNotebook(sampleNotebook());
    expect(document.cells).toHaveLength(2);
    expect(parseNotebook(serializeNotebook(document))).toEqual(document);
  });

  it('rejects invalid notebook JSON and schema', () => {
    expect(() => parseNotebook('not json')).toThrow();
    expect(() => parseNotebook('{"nbformat":3,"cells":[]}')).toThrow();
  });

  it('inserts, replaces, and deletes cells without mutating the input', () => {
    const document = parseNotebook(sampleNotebook());
    const inserted = insertNotebookCell(document, { index: 1, cellType: 'markdown', source: 'note' });
    expect(inserted.document.cells).toHaveLength(3);
    expect(document.cells).toHaveLength(2);
    const replaced = replaceNotebookCell(inserted.document, { index: 1, source: 'changed' });
    expect(replaced.cells[1]?.source).toBe('changed');
    const deleted = deleteNotebookCell(replaced, 1);
    expect(deleted.document.cells).toHaveLength(2);
    expect(deleted.removed.source).toBe('changed');
  });

  it('rejects out-of-range indexes and empty replacements', () => {
    const document = parseNotebook(sampleNotebook());
    expect(() => insertNotebookCell(document, { index: 99, cellType: 'code', source: '' })).toThrow(
      'out of range',
    );
    expect(() => replaceNotebookCell(document, { index: 0 })).toThrow('replace requires');
    expect(() => deleteNotebookCell(document, 9)).toThrow('out of range');
  });

  it('summarizes cells with the configured bound', () => {
    const document = parseNotebook(sampleNotebook());
    const summary = summarizeNotebook(document, 200);
    expect(summary).toContain('cells: 2');
    expect(summary).toContain('# Title');
    expect(summary).toContain('print(1)');
    expect(summarizeNotebook(document, 10)).toContain('truncated');
  });
});

describe('NotebookEditTool', () => {
  it('reads, inserts, replaces, and deletes cells with atomic persistence', async () => {
    const dir = await tempDir();
    const notebookPath = join(dir, 'notes.ipynb');
    await writeFile(notebookPath, sampleNotebook(), 'utf8');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new NotebookEditTool(tr.runtimeService, tr.workspaceCtx);

    const read = await executable(
      tool.resolveExecution({ action: 'read', path: 'notes.ipynb' }),
    ).execute(tr.context);
    expect(output(read)).toContain('cells: 2');

    const insert = await executable(
      tool.resolveExecution({
        action: 'insert',
        path: 'notes.ipynb',
        index: 0,
        cell_type: 'markdown',
        source: '# Inserted',
      }),
    ).execute(tr.context);
    expect(output(insert)).toContain('Inserted cell at index 0');

    const replace = await executable(
      tool.resolveExecution({
        action: 'replace',
        path: 'notes.ipynb',
        index: 0,
        source: '# Replaced',
      }),
    ).execute(tr.context);
    expect(output(replace)).toContain('Replaced cell at index 0');

    const remove = await executable(
      tool.resolveExecution({ action: 'delete', path: 'notes.ipynb', index: 0 }),
    ).execute(tr.context);
    expect(output(remove)).toContain('Deleted cell at index 0');

    const persisted = JSON.parse(await readFile(notebookPath, 'utf8')) as {
      cells: Array<{ source: string }>;
    };
    expect(persisted.cells).toHaveLength(2);
    const names = await readdir(dir);
    expect(names.filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('reports schema and range failures as tool errors', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'bad.ipynb'), '{"nbformat": 4, "cells": "wrong"}', 'utf8');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new NotebookEditTool(tr.runtimeService, tr.workspaceCtx);
    const result = await executable(
      tool.resolveExecution({ action: 'read', path: 'bad.ipynb' }),
    ).execute(tr.context);
    expect(result.isError).toBe(true);
    const missing = await executable(
      tool.resolveExecution({ action: 'read', path: 'missing.ipynb' }),
    ).execute(tr.context);
    expect(missing.isError).toBe(true);
  });
});
