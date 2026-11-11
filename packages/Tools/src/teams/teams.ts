import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  MAX_TEAM_MEMBERS,
  MEMBER_MAX_CHARS,
  TASK_TITLE_MAX_CHARS,
  TEAM_ID_PATTERN,
} from '#/tasks/taskBoardStore';

const teamIdSchema = z.string().regex(TEAM_ID_PATTERN).describe('Team id, for example team-1.');
const memberSchema = z.string().min(1).max(MEMBER_MAX_CHARS);

export const TeamCreateInputSchema = z.object({
  name: z.string().min(1).max(TASK_TITLE_MAX_CHARS).describe('Human-readable team name.'),
  members: z
    .array(memberSchema)
    .max(MAX_TEAM_MEMBERS)
    .optional()
    .describe('Optional initial members; the current agent is always added.'),
});
export type TeamCreateInput = z.infer<typeof TeamCreateInputSchema>;

export const TeamMembershipInputSchema = z.object({
  team_id: teamIdSchema,
  member: memberSchema.optional().describe('Member to join or leave; defaults to the current agent.'),
});
export type TeamMembershipInput = z.infer<typeof TeamMembershipInputSchema>;

export const TeamListInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional().describe('Maximum teams to return.'),
});
export type TeamListInput = z.infer<typeof TeamListInputSchema>;

export interface ITeamCreateTool extends AgentTool<TeamCreateInput> {
  readonly _serviceBrand: undefined;
}
export const ITeamCreateTool = createDecorator<ITeamCreateTool>('teamCreateTool');

export interface ITeamJoinTool extends AgentTool<TeamMembershipInput> {
  readonly _serviceBrand: undefined;
}
export const ITeamJoinTool = createDecorator<ITeamJoinTool>('teamJoinTool');

export interface ITeamLeaveTool extends AgentTool<TeamMembershipInput> {
  readonly _serviceBrand: undefined;
}
export const ITeamLeaveTool = createDecorator<ITeamLeaveTool>('teamLeaveTool');

export interface ITeamListTool extends AgentTool<TeamListInput> {
  readonly _serviceBrand: undefined;
}
export const ITeamListTool = createDecorator<ITeamListTool>('teamListTool');
