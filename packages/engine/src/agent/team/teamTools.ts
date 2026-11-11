import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ITeamService } from '#/agent/team/teamService';
import { toInputJsonSchema } from '#/tool/input-schema';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import {
  type AgentTool,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';

export const TeamToolInputSchema = z.object({
  action: z.enum([
    'create',
    'join',
    'leave',
    'members',
    'add_task',
    'update_task',
    'list_tasks',
    'claim_task',
  ]),
  team_id: z.string().optional(),
  agent_id: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  task_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  status: z.enum(['open', 'claimed', 'completed', 'cancelled']).optional(),
  assignee_id: z.string().optional(),
  filter_status: z.enum(['open', 'claimed', 'completed', 'cancelled']).optional(),
});

export type TeamToolInput = z.infer<typeof TeamToolInputSchema>;

export interface ITeamTool extends AgentTool<TeamToolInput> {
  readonly _serviceBrand: undefined;
}

export const ITeamTool = createDecorator<ITeamTool>('teamTool');

function missing(field: string): ExecutableToolResult {
  return { isError: true, output: `Missing required field: ${field}` };
}

export class TeamTool implements ITeamTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Team' as const;
  readonly description =
    'Create and coordinate an agent team. Manage members and a shared task list. ' +
    'Actions: create, join, leave, members, add_task, update_task, list_tasks, claim_task.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TeamToolInputSchema);

  constructor(
    @ITeamService private readonly teams: ITeamService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: TeamToolInput): ToolExecution {
    return {
      description: `Team ${args.action}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.action),
      execute: async () => this.execute(args),
    };
  }

  private execute(args: TeamToolInput): ExecutableToolResult {
    const teamId = args.team_id;
    const agentId = args.agent_id ?? this.scope.agentId;
    switch (args.action) {
      case 'create':
        return this.ok(this.teams.createTeam({ id: teamId, name: args.name }));
      case 'join':
        if (teamId === undefined) return missing('team_id');
        return this.ok(this.teams.joinAgent(teamId, agentId, { role: args.role }));
      case 'leave':
        if (teamId === undefined) return missing('team_id');
        return this.ok(this.teams.leaveAgent(teamId, agentId));
      case 'members':
        if (teamId === undefined) return missing('team_id');
        return this.ok(this.teams.listMembers(teamId));
      case 'add_task':
        if (teamId === undefined) return missing('team_id');
        if (args.title === undefined) return missing('title');
        return this.ok(
          this.teams.addTask(teamId, {
            title: args.title,
            description: args.description,
            priority: args.priority,
          }),
        );
      case 'update_task':
        if (teamId === undefined) return missing('team_id');
        if (args.task_id === undefined) return missing('task_id');
        return this.ok(
          this.teams.updateTask(teamId, args.task_id, {
            title: args.title,
            description: args.description,
            priority: args.priority,
            status: args.status,
            assigneeId: args.assignee_id === undefined ? undefined : args.assignee_id || null,
          }),
        );
      case 'list_tasks':
        if (teamId === undefined) return missing('team_id');
        return this.ok(this.teams.listTasks(teamId, { status: args.filter_status }));
      case 'claim_task':
        if (teamId === undefined) return missing('team_id');
        if (args.task_id === undefined) return missing('task_id');
        return this.ok(this.teams.claimTask(teamId, args.task_id, agentId));
    }
  }

  private ok(value: unknown): ExecutableToolResult {
    return { output: JSON.stringify(value, null, 2), isError: false };
  }
}

registerAgentToolService(ITeamTool, TeamTool, { name: 'Team', domain: 'agentTask' });
