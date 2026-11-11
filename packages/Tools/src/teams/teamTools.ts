import { ITeamService } from '@hilbras/omnicode-engine/agent/team/teamService';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';

import { truncateTextAtCharBoundary } from '#/diagnostics/toolResultDiagnostics';
import {
  listTeamRecords,
  type TaskBoardData,
} from '#/tasks/taskBoardStore';
import {
  ITeamCreateTool,
  ITeamJoinTool,
  ITeamLeaveTool,
  ITeamListTool,
  TeamCreateInputSchema,
  TeamListInputSchema,
  TeamMembershipInputSchema,
  type TeamCreateInput,
  type TeamListInput,
  type TeamMembershipInput,
} from './teams';

const MAX_TEAM_OUTPUT_CHARS = 50_000;

function renderEngineTeam(service: ITeamService, teamId: string): string {
  return JSON.stringify(service.snapshot(teamId), null, 2);
}

function run(name: string, summary: string, run: () => string): ToolExecution {
  return {
    accesses: [],
    description: summary,
    display: { kind: 'generic', summary },
    approvalRule: name,
    execute: async (): Promise<ExecutableToolResult> => {
      try {
        return { output: run(), isError: false };
      } catch (error) {
        return { isError: true, output: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export class TeamCreateTool implements ITeamCreateTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TeamCreate' as const;
  readonly description =
    'Create a team through the session team service. The current agent is always a member.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TeamCreateInputSchema);

  constructor(
    @ITeamService private readonly teams: ITeamService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: TeamCreateInput): ToolExecution {
    return run(this.name, `Creating team: ${args.name}`, () => {
      const team = this.teams.createTeam({ name: args.name });
      this.teams.joinAgent(team.id, this.scope.agentId);
      for (const member of args.members ?? []) {
        if (member === this.scope.agentId || this.teams.getMember(team.id, member) !== undefined) continue;
        this.teams.joinAgent(team.id, member);
      }
      return `Created ${team.id}.\n${renderEngineTeam(this.teams, team.id)}`;
    });
  }
}

export class TeamJoinTool implements ITeamJoinTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TeamJoin' as const;
  readonly description = 'Join an existing team; defaults to the current agent.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TeamMembershipInputSchema);

  constructor(
    @ITeamService private readonly teams: ITeamService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: TeamMembershipInput): ToolExecution {
    return run(this.name, `Joining team ${args.team_id}`, () => {
      const member = this.teams.joinAgent(args.team_id, args.member ?? this.scope.agentId);
      return JSON.stringify(member, null, 2);
    });
  }
}

export class TeamLeaveTool implements ITeamLeaveTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TeamLeave' as const;
  readonly description = 'Leave a team; defaults to the current agent.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TeamMembershipInputSchema);

  constructor(
    @ITeamService private readonly teams: ITeamService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: TeamMembershipInput): ToolExecution {
    return run(this.name, `Leaving team ${args.team_id}`, () => {
      return JSON.stringify(this.teams.leaveAgent(args.team_id, args.member ?? this.scope.agentId), null, 2);
    });
  }
}

export class TeamListTool implements ITeamListTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'TeamList' as const;
  readonly description = 'List teams from the session team service.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TeamListInputSchema);

  constructor(@ITeamService private readonly teams: ITeamService) {}

  resolveExecution(args: TeamListInput): ToolExecution {
    return run(this.name, 'Listing teams', () => {
      const teams = this.teams.listTeams().slice(0, args.limit ?? 100);
      if (teams.length === 0) return 'teams: 0\nNo teams found.';
      return truncateTextAtCharBoundary(
        `teams: ${String(teams.length)}\n${teams.map((team) => renderEngineTeam(this.teams, team.id)).join('\n---\n')}`,
        MAX_TEAM_OUTPUT_CHARS,
      );
    });
  }
}

export function renderTeamList(data: TaskBoardData, args: TeamListInput = {}): string {
  const teams = listTeamRecords(data, args.limit ?? 100);
  if (teams.length === 0) return 'teams: 0\nNo teams found.';
  return truncateTextAtCharBoundary(
    `teams: ${String(teams.length)}\n${teams.map((team) => JSON.stringify(team, null, 2)).join('\n---\n')}`,
    MAX_TEAM_OUTPUT_CHARS,
  );
}

registerAgentToolService(ITeamCreateTool, TeamCreateTool, {
  name: 'TeamCreate',
  domain: 'teams',
});
registerAgentToolService(ITeamJoinTool, TeamJoinTool, {
  name: 'TeamJoin',
  domain: 'teams',
});
registerAgentToolService(ITeamLeaveTool, TeamLeaveTool, {
  name: 'TeamLeave',
  domain: 'teams',
});
registerAgentToolService(ITeamListTool, TeamListTool, {
  name: 'TeamList',
  domain: 'teams',
});
