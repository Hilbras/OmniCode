import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  MEMBER_MAX_CHARS,
  TASK_DESCRIPTION_MAX_CHARS,
  TASK_ID_PATTERN,
  TASK_TITLE_MAX_CHARS,
  TEAM_ID_PATTERN,
  taskStatusSchema,
} from './taskBoardStore';

const teamIdSchema = z.string().regex(TEAM_ID_PATTERN).describe('Team id, for example team-1.');
const memberSchema = z.string().min(1).max(MEMBER_MAX_CHARS);

export const TaskBoardCreateInputSchema = z.object({
  title: z.string().min(1).max(TASK_TITLE_MAX_CHARS).describe('Short task title.'),
  description: z
    .string()
    .max(TASK_DESCRIPTION_MAX_CHARS)
    .optional()
    .describe('Optional task details.'),
  status: taskStatusSchema.optional().describe('Initial task status; defaults to pending.'),
  team_id: teamIdSchema.optional().describe('Optional team that owns the task.'),
  assignee: memberSchema.optional().describe('Optional agent id assigned to the task.'),
});
export type TaskBoardCreateInput = z.infer<typeof TaskBoardCreateInputSchema>;

export const TaskBoardUpdateInputSchema = z.object({
  id: z.string().regex(TASK_ID_PATTERN).describe('Task id to update.'),
  title: z.string().min(1).max(TASK_TITLE_MAX_CHARS).optional(),
  description: z.string().max(TASK_DESCRIPTION_MAX_CHARS).nullable().optional(),
  status: taskStatusSchema.optional(),
  team_id: teamIdSchema.nullable().optional(),
  assignee: memberSchema.nullable().optional(),
});
export type TaskBoardUpdateInput = z.infer<typeof TaskBoardUpdateInputSchema>;

export const TaskBoardListInputSchema = z.object({
  status: taskStatusSchema.optional(),
  team_id: teamIdSchema.optional(),
  assignee: memberSchema.optional(),
  limit: z.number().int().positive().max(500).optional().describe('Maximum tasks to return.'),
});
export type TaskBoardListInput = z.infer<typeof TaskBoardListInputSchema>;

export interface ITaskBoardCreateTool extends AgentTool<TaskBoardCreateInput> {
  readonly _serviceBrand: undefined;
}
export const ITaskBoardCreateTool = createDecorator<ITaskBoardCreateTool>('taskBoardCreateTool');

export interface ITaskBoardUpdateTool extends AgentTool<TaskBoardUpdateInput> {
  readonly _serviceBrand: undefined;
}
export const ITaskBoardUpdateTool = createDecorator<ITaskBoardUpdateTool>('taskBoardUpdateTool');

export interface ITaskBoardListTool extends AgentTool<TaskBoardListInput> {
  readonly _serviceBrand: undefined;
}
export const ITaskBoardListTool = createDecorator<ITaskBoardListTool>('taskBoardListTool');
