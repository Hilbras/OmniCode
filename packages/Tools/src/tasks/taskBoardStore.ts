import { z } from 'zod';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';

import { writeTextAtomic } from '#/shared/atomicWrite';

export const TASK_BOARD_FILE_NAME = 'task-board.json';
export const MAX_TASKS = 500;
export const MAX_TEAMS = 100;
export const MAX_TEAM_MEMBERS = 50;
export const TASK_TITLE_MAX_CHARS = 200;
export const TASK_DESCRIPTION_MAX_CHARS = 4_000;
export const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const TEAM_ID_PATTERN = TASK_ID_PATTERN;
export const MEMBER_MAX_CHARS = 120;

export const taskStatusSchema = z.enum(['pending', 'in_progress', 'done', 'blocked']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskRecordSchema = z.object({
  id: z.string().regex(TASK_ID_PATTERN),
  title: z.string().min(1).max(TASK_TITLE_MAX_CHARS),
  description: z.string().max(TASK_DESCRIPTION_MAX_CHARS).optional(),
  status: taskStatusSchema,
  teamId: z.string().regex(TEAM_ID_PATTERN).optional(),
  assignee: z.string().min(1).max(MEMBER_MAX_CHARS).optional(),
  createdBy: z.string().min(1).max(MEMBER_MAX_CHARS),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const teamRecordSchema = z.object({
  id: z.string().regex(TEAM_ID_PATTERN),
  name: z.string().min(1).max(TASK_TITLE_MAX_CHARS),
  members: z.array(z.string().min(1).max(MEMBER_MAX_CHARS)).max(MAX_TEAM_MEMBERS),
  createdAt: z.number().int().nonnegative(),
});
export type TeamRecord = z.infer<typeof teamRecordSchema>;

export const taskBoardSchema = z.object({
  version: z.literal(1),
  nextTaskId: z.number().int().positive(),
  nextTeamId: z.number().int().positive(),
  tasks: z.array(taskRecordSchema).max(MAX_TASKS),
  teams: z.array(teamRecordSchema).max(MAX_TEAMS),
});
export type TaskBoardData = z.infer<typeof taskBoardSchema>;

export function emptyTaskBoard(): TaskBoardData {
  return { version: 1, nextTaskId: 1, nextTeamId: 1, tasks: [], teams: [] };
}

export function parseTaskBoard(text: string): TaskBoardData {
  if (text.trim().length === 0) return emptyTaskBoard();
  const parsed = taskBoardSchema.parse(JSON.parse(text));
  return parsed;
}

export function serializeTaskBoard(data: TaskBoardData): string {
  return `${JSON.stringify(taskBoardSchema.parse(data), null, 2)}\n`;
}

export function isValidTaskId(id: string): boolean {
  return TASK_ID_PATTERN.test(id);
}

export function isValidTeamId(id: string): boolean {
  return TEAM_ID_PATTERN.test(id);
}

export function makeTaskId(data: TaskBoardData): string {
  return `task-${String(data.nextTaskId)}`;
}

export function makeTeamId(data: TaskBoardData): string {
  return `team-${String(data.nextTeamId)}`;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly status?: TaskStatus;
  readonly teamId?: string;
  readonly assignee?: string;
  readonly createdBy: string;
}

export function createTaskRecord(
  data: TaskBoardData,
  input: CreateTaskInput,
  now: number,
): { data: TaskBoardData; task: TaskRecord } {
  if (data.tasks.length >= MAX_TASKS) {
    throw new Error(`Task limit reached (max ${String(MAX_TASKS)}).`);
  }
  if (input.teamId !== undefined && !data.teams.some((team) => team.id === input.teamId)) {
    throw new Error(`Unknown team: ${input.teamId}.`);
  }
  const task: TaskRecord = {
    id: makeTaskId(data),
    title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    status: input.status ?? 'pending',
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const next = taskBoardSchema.parse({
    ...data,
    nextTaskId: data.nextTaskId + 1,
    tasks: [...data.tasks, task],
  });
  return { data: next, task };
}

export interface UpdateTaskInput {
  readonly id: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly teamId?: string | null;
  readonly assignee?: string | null;
}

export function updateTaskRecord(
  data: TaskBoardData,
  input: UpdateTaskInput,
  now: number,
): { data: TaskBoardData; task: TaskRecord } {
  const index = data.tasks.findIndex((task) => task.id === input.id);
  if (index < 0) throw new Error(`Unknown task: ${input.id}.`);
  const current = data.tasks[index]!;
  if (input.teamId !== undefined && input.teamId !== null) {
    if (!data.teams.some((team) => team.id === input.teamId)) {
      throw new Error(`Unknown team: ${input.teamId}.`);
    }
  }
  const updated: TaskRecord = {
    ...current,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined
      ? {}
      : input.description === null
        ? { description: undefined }
        : { description: input.description }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.teamId === undefined
      ? {}
      : input.teamId === null
        ? { teamId: undefined }
        : { teamId: input.teamId }),
    ...(input.assignee === undefined
      ? {}
      : input.assignee === null
        ? { assignee: undefined }
        : { assignee: input.assignee }),
    updatedAt: now,
  };
  const tasks = data.tasks.slice();
  tasks[index] = updated;
  return { data: taskBoardSchema.parse({ ...data, tasks }), task: updated };
}

export interface ListTasksInput {
  readonly status?: TaskStatus;
  readonly teamId?: string;
  readonly assignee?: string;
  readonly limit?: number;
}

export function listTaskRecords(data: TaskBoardData, input: ListTasksInput = {}): TaskRecord[] {
  const limit = Math.max(1, Math.min(input.limit ?? 100, MAX_TASKS));
  return data.tasks
    .filter((task) => input.status === undefined || task.status === input.status)
    .filter((task) => input.teamId === undefined || task.teamId === input.teamId)
    .filter((task) => input.assignee === undefined || task.assignee === input.assignee)
    .slice(0, limit);
}

export function createTeamRecord(
  data: TaskBoardData,
  input: { readonly name: string; readonly members?: readonly string[]; readonly createdBy: string },
  now: number,
): { data: TaskBoardData; team: TeamRecord } {
  if (data.teams.length >= MAX_TEAMS) {
    throw new Error(`Team limit reached (max ${String(MAX_TEAMS)}).`);
  }
  const members = Array.from(new Set([...input.members ?? [], input.createdBy]));
  if (members.length > MAX_TEAM_MEMBERS) {
    throw new Error(`Team member limit reached (max ${String(MAX_TEAM_MEMBERS)}).`);
  }
  const team: TeamRecord = {
    id: makeTeamId(data),
    name: input.name,
    members,
    createdAt: now,
  };
  const next = taskBoardSchema.parse({
    ...data,
    nextTeamId: data.nextTeamId + 1,
    teams: [...data.teams, team],
  });
  return { data: next, team };
}

export function joinTeamRecord(
  data: TaskBoardData,
  input: { readonly teamId: string; readonly member: string },
): { data: TaskBoardData; team: TeamRecord } {
  const index = data.teams.findIndex((team) => team.id === input.teamId);
  if (index < 0) throw new Error(`Unknown team: ${input.teamId}.`);
  const current = data.teams[index]!;
  if (current.members.includes(input.member)) {
    return { data, team: current };
  }
  if (current.members.length >= MAX_TEAM_MEMBERS) {
    throw new Error(`Team member limit reached (max ${String(MAX_TEAM_MEMBERS)}).`);
  }
  const team: TeamRecord = { ...current, members: [...current.members, input.member] };
  const teams = data.teams.slice();
  teams[index] = team;
  return { data: taskBoardSchema.parse({ ...data, teams }), team };
}

export function leaveTeamRecord(
  data: TaskBoardData,
  input: { readonly teamId: string; readonly member: string },
): { data: TaskBoardData; team: TeamRecord } {
  const index = data.teams.findIndex((team) => team.id === input.teamId);
  if (index < 0) throw new Error(`Unknown team: ${input.teamId}.`);
  const current = data.teams[index]!;
  const team: TeamRecord = {
    ...current,
    members: current.members.filter((member) => member !== input.member),
  };
  const teams = data.teams.slice();
  teams[index] = team;
  return { data: taskBoardSchema.parse({ ...data, teams }), team };
}

export function listTeamRecords(data: TaskBoardData, limit = 100): TeamRecord[] {
  return data.teams.slice(0, Math.max(1, Math.min(limit, MAX_TEAMS)));
}

export class FileTaskBoardStore {
  constructor(
    private readonly fs: IHostFileSystem,
    readonly path: string,
  ) {}

  async load(): Promise<TaskBoardData> {
    try {
      return parseTaskBoard(await this.fs.readText(this.path));
    } catch (error) {
      if (isNotFound(error)) return emptyTaskBoard();
      throw error;
    }
  }

  async save(data: TaskBoardData): Promise<void> {
    await writeTextAtomic(this.fs, this.path, serializeTaskBoard(data));
  }
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'os.fs.not_found';
}
