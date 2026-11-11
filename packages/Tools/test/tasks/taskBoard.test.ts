import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { HostFileSystem } from '@hilbras/omnicode-engine/os/backends/node-local/hostFsService';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  FileTaskBoardStore,
  MAX_TASKS,
  TASK_BOARD_FILE_NAME,
  createTaskRecord,
  emptyTaskBoard,
  listTaskRecords,
  parseTaskBoard,
  serializeTaskBoard,
  updateTaskRecord,
} from '#/tasks/taskBoardStore';
import {
  TaskBoardCreateTool,
  TaskBoardListTool,
  TaskBoardUpdateTool,
} from '#/tasks/taskBoardTools';
import { makeTestRuntime } from '../helpers/testRuntime';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-task-board-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('task board store', () => {
  it('creates, updates, and filters task records', () => {
    const empty = emptyTaskBoard();
    const created = createTaskRecord(empty, { title: 'First', createdBy: 'agent-a' }, 10);
    expect(created.task.id).toBe('task-1');
    expect(created.task.status).toBe('pending');
    const second = createTaskRecord(
      created.data,
      { title: 'Second', status: 'in_progress', assignee: 'agent-b', createdBy: 'agent-a' },
      11,
    );
    expect(second.task.id).toBe('task-2');
    const updated = updateTaskRecord(second.data, { id: 'task-1', status: 'done' }, 12);
    expect(updated.task.updatedAt).toBe(12);
    expect(listTaskRecords(updated.data, { status: 'done' })).toHaveLength(1);
    expect(listTaskRecords(updated.data, { assignee: 'agent-b' })[0]?.title).toBe('Second');
    expect(listTaskRecords(updated.data, { limit: 1 })).toHaveLength(1);
  });

  it('rejects unknown tasks and unknown teams', () => {
    expect(() => updateTaskRecord(emptyTaskBoard(), { id: 'task-99', title: 'x' }, 1)).toThrow(
      'Unknown task',
    );
    expect(() =>
      createTaskRecord(emptyTaskBoard(), { title: 'x', teamId: 'team-99', createdBy: 'a' }, 1),
    ).toThrow('Unknown team');
  });

  it('round-trips through serialization and rejects corrupted data', () => {
    const data = createTaskRecord(emptyTaskBoard(), { title: 'Task', createdBy: 'a' }, 1).data;
    expect(parseTaskBoard(serializeTaskBoard(data))).toEqual(data);
    expect(() => parseTaskBoard('{"version":2}')).toThrow();
  });

  it('persists through FileTaskBoardStore and returns empty for a missing file', async () => {
    const dir = await tempDir();
    const fs = new HostFileSystem();
    const path = join(dir, TASK_BOARD_FILE_NAME);
    const store = new FileTaskBoardStore(fs, path);
    expect(await store.load()).toEqual(emptyTaskBoard());
    const data = createTaskRecord(emptyTaskBoard(), { title: 'Stored', createdBy: 'a' }, 5).data;
    await store.save(data);
    expect(await store.load()).toEqual(data);
  });

  it('enforces the task cap', () => {
    const data = emptyTaskBoard();
    const tasks = Array.from({ length: MAX_TASKS }, (_, index) => ({
      id: `task-${String(index + 1)}`,
      title: `Task ${String(index + 1)}`,
      status: 'pending' as const,
      createdBy: 'a',
      createdAt: 1,
      updatedAt: 1,
    }));
    expect(() =>
      createTaskRecord({ ...data, tasks, nextTaskId: MAX_TASKS + 1 }, { title: 'x', createdBy: 'a' }, 1),
    ).toThrow('Task limit');
  });
});

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

describe('task board tools', () => {
  it('creates, updates, and lists tasks through the real tool classes', async () => {
    const dir = await tempDir();
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const create = new TaskBoardCreateTool(tr.runtimeService, tr.sessionCtx, tr.scopeCtx);
    const created = await executable(
      create.resolveExecution({ title: 'Wire task tools', description: 'details' }),
    ).execute(tr.context);
    expect(output(created)).toContain('Created task-1');

    const update = new TaskBoardUpdateTool(tr.runtimeService, tr.sessionCtx);
    const updated = await executable(
      update.resolveExecution({ id: 'task-1', status: 'done', assignee: 'agent-test' }),
    ).execute(tr.context);
    expect(output(updated)).toContain('"status": "done"');

    const list = new TaskBoardListTool(tr.runtimeService, tr.sessionCtx);
    const listed = await executable(list.resolveExecution({ status: 'done' })).execute(tr.context);
    expect(output(listed)).toContain('Wire task tools');
    expect(output(listed)).toContain('tasks: 1');
  });

  it('surfaces unknown task ids as tool errors', async () => {
    const dir = await tempDir();
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const update = new TaskBoardUpdateTool(tr.runtimeService, tr.sessionCtx);
    const result = await executable(update.resolveExecution({ id: 'task-404' })).execute(tr.context);
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('Unknown task');
  });
});
