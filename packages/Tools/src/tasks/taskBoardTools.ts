import { join } from 'pathe';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import { IAgentRuntimeService } from '@hilbras/omnicode-engine/agent/runtimeBinding/agentRuntime';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import { ISessionContext } from '@hilbras/omnicode-engine/session/sessionContext/sessionContext';
import type { ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { ToolAccesses } from '@hilbras/omnicode-engine/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';

import { truncateTextAtCharBoundary } from '#/diagnostics/toolResultDiagnostics';
import {
  FileTaskBoardStore,
  TASK_BOARD_FILE_NAME,
  createTaskRecord,
  listTaskRecords,
  updateTaskRecord,
  type TaskBoardData,
  type TaskRecord,
} from './taskBoardStore';
import {
  ITaskBoardCreateTool,
  ITaskBoardListTool,
  ITaskBoardUpdateTool,
  TaskBoardCreateInputSchema,
  TaskBoardListInputSchema,
  TaskBoardUpdateInputSchema,
  type TaskBoardCreateInput,
  type TaskBoardListInput,
  type TaskBoardUpdateInput,
} from './task-board';

const MAX_TASK_BOARD_OUTPUT_CHARS = 50_000;

function renderTask(task: TaskRecord): string {
  return JSON.stringify(task, null, 2);
}

function boardPath(sessionDir: string): string {
  return join(sessionDir, TASK_BOARD_FILE_NAME);
}

function acquireFs(
  runtime: IAgentRuntimeService,
): { fs: IHostFileSystem; dispose: () => void } | { error: string } {
  const lease = runtime.acquire(['fs']);
  const fs = lease.runtime.fs;
  if (fs === undefined) {
    lease.dispose();
    return { error: 'Filesystem runtime is unavailable.' };
  }
  return { fs, dispose: () => lease.dispose() };
}

function toExecution(
  name: string,
  summary: string,
  run: (fs: IHostFileSystem) => Promise<{ output: string; isError?: boolean }>,
  runtime: IAgentRuntimeService,
  sessionDir: string,
): ToolExecution {
  const path = boardPath(sessionDir);
  return {
    accesses: ToolAccesses.readWriteFile(path),
    description: summary,
    display: { kind: 'generic', summary },
    approvalRule: name,
    execute: async () => {
      const acquired = acquireFs(runtime);
      if ('error' in acquired) return { isError: true, output: acquired.error };
      try {
        return await run(acquired.fs);
      } catch (error) {
        return { isError: true, output: error instanceof Error ? error.message : String(error) };
      } finally {
        acquired.dispose();
      }
    },
  };
}

export class TaskBoardCreateTool implements ITaskBoardCreateTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TaskBoardCreate' as const;
  readonly description =
    'Create a task in the shared session task board. The board is separate from background TaskList tasks and can be scoped to a team.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TaskBoardCreateInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly session: ISessionContext,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: TaskBoardCreateInput): ToolExecution {
    return toExecution(
      this.name,
      `Creating task: ${args.title}`,
      async (fs) => {
        const store = new FileTaskBoardStore(fs, boardPath(this.session.sessionDir));
        const data = await store.load();
        const result = createTaskRecord(
          data,
          {
            title: args.title,
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.status === undefined ? {} : { status: args.status }),
            ...(args.team_id === undefined ? {} : { teamId: args.team_id }),
            ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
            createdBy: this.scope.agentId,
          },
          Date.now(),
        );
        await store.save(result.data);
        return { output: `Created ${result.task.id}.\n${renderTask(result.task)}` };
      },
      this.runtime,
      this.session.sessionDir,
    );
  }
}

export class TaskBoardUpdateTool implements ITaskBoardUpdateTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TaskBoardUpdate' as const;
  readonly description = 'Update a shared task board task.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TaskBoardUpdateInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly session: ISessionContext,
  ) {}

  resolveExecution(args: TaskBoardUpdateInput): ToolExecution {
    return toExecution(
      this.name,
      `Updating task ${args.id}`,
      async (fs) => {
        const store = new FileTaskBoardStore(fs, boardPath(this.session.sessionDir));
        const data = await store.load();
        const result = updateTaskRecord(
          data,
          {
            id: args.id,
            ...(args.title === undefined ? {} : { title: args.title }),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.status === undefined ? {} : { status: args.status }),
            ...(args.team_id === undefined ? {} : { teamId: args.team_id }),
            ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
          },
          Date.now(),
        );
        await store.save(result.data);
        return { output: `Updated ${result.task.id}.\n${renderTask(result.task)}` };
      },
      this.runtime,
      this.session.sessionDir,
    );
  }
}

export class TaskBoardListTool implements ITaskBoardListTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TaskBoardList' as const;
  readonly description =
    'List shared task board tasks. This lists the team/task board, not background shell tasks (use TaskList for those).';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TaskBoardListInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly session: ISessionContext,
  ) {}

  resolveExecution(args: TaskBoardListInput): ToolExecution {
    return toExecution(
      this.name,
      'Listing shared tasks',
      async (fs) => {
        const store = new FileTaskBoardStore(fs, boardPath(this.session.sessionDir));
        const data = await store.load();
        return { output: renderTaskList(data, args) };
      },
      this.runtime,
      this.session.sessionDir,
    );
  }
}

export function renderTaskList(data: TaskBoardData, args: TaskBoardListInput = {}): string {
  const tasks = listTaskRecords(data, {
    ...(args.status === undefined ? {} : { status: args.status }),
    ...(args.team_id === undefined ? {} : { teamId: args.team_id }),
    ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
  });
  if (tasks.length === 0) return 'tasks: 0\nNo shared tasks found.';
  return truncateTextAtCharBoundary(
    `tasks: ${String(tasks.length)}\n${tasks.map(renderTask).join('\n---\n')}`,
    MAX_TASK_BOARD_OUTPUT_CHARS,
  );
}

registerAgentToolService(ITaskBoardCreateTool, TaskBoardCreateTool, {
  name: 'TaskBoardCreate',
  domain: 'taskBoard',
  requiredRuntimeCapabilities: ['fs'],
});
registerAgentToolService(ITaskBoardUpdateTool, TaskBoardUpdateTool, {
  name: 'TaskBoardUpdate',
  domain: 'taskBoard',
  requiredRuntimeCapabilities: ['fs'],
});
registerAgentToolService(ITaskBoardListTool, TaskBoardListTool, {
  name: 'TaskBoardList',
  domain: 'taskBoard',
  requiredRuntimeCapabilities: ['fs'],
});
