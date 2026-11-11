import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { TeamService } from '@hilbras/omnicode-engine/agent/team/teamService';
import { TeamTool } from '@hilbras/omnicode-engine/agent/team/teamTools';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  createTeamRecord,
  emptyTaskBoard,
  joinTeamRecord,
  leaveTeamRecord,
  listTeamRecords,
} from '#/tasks/taskBoardStore';
import { TeamCreateTool, TeamJoinTool, TeamLeaveTool, TeamListTool } from '#/teams/teamTools';
import { makeTestRuntime } from '../helpers/testRuntime';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-team-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('team store', () => {
  it('creates a team with the creator and deduplicated members', () => {
    const result = createTeamRecord(
      emptyTaskBoard(),
      { name: 'core', members: ['agent-a', 'agent-b'], createdBy: 'agent-a' },
      10,
    );
    expect(result.team.id).toBe('team-1');
    expect(result.team.members).toEqual(['agent-a', 'agent-b']);
    expect(listTeamRecords(result.data)).toHaveLength(1);
  });

  it('joins idempotently and leaves a team', () => {
    const created = createTeamRecord(emptyTaskBoard(), { name: 'core', createdBy: 'agent-a' }, 1);
    const joined = joinTeamRecord(created.data, { teamId: 'team-1', member: 'agent-b' });
    expect(joined.team.members).toEqual(['agent-a', 'agent-b']);
    const again = joinTeamRecord(joined.data, { teamId: 'team-1', member: 'agent-b' });
    expect(again.data).toBe(joined.data);
    const left = leaveTeamRecord(joined.data, { teamId: 'team-1', member: 'agent-a' });
    expect(left.team.members).toEqual(['agent-b']);
  });

  it('rejects unknown teams', () => {
    expect(() => joinTeamRecord(emptyTaskBoard(), { teamId: 'team-9', member: 'a' })).toThrow(
      'Unknown team',
    );
    expect(() => leaveTeamRecord(emptyTaskBoard(), { teamId: 'team-9', member: 'a' })).toThrow(
      'Unknown team',
    );
  });
});

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

describe('team tools', () => {
  it('creates, joins, leaves, and lists teams through the shared team service', async () => {
    const tr = makeTestRuntime({ workDir: '/tmp' });
    const teams = new TeamService();
    const create = new TeamCreateTool(teams, tr.scopeCtx);
    const joined = new TeamJoinTool(teams, tr.scopeCtx);
    const leave = new TeamLeaveTool(teams, tr.scopeCtx);
    const list = new TeamListTool(teams);

    const created = await executable(create.resolveExecution({ name: 'core' })).execute(tr.context);
    expect(output(created)).toContain('Created team-1');
    expect(output(created)).toContain('agent-test');
    const withMember = await executable(
      joined.resolveExecution({ team_id: 'team-1', member: 'agent-b' }),
    ).execute(tr.context);
    expect(output(withMember)).toContain('agent-b');
    const listed = await executable(list.resolveExecution({})).execute(tr.context);
    expect(output(listed)).toContain('teams: 1');
    await executable(
      leave.resolveExecution({ team_id: 'team-1', member: 'agent-b' }),
    ).execute(tr.context);
    const afterLeave = await executable(list.resolveExecution({})).execute(tr.context);
    expect(output(afterLeave)).not.toContain('agent-b');
  });

  it('shares team state with the engine Team tool', async () => {
    const tr = makeTestRuntime({ workDir: '/tmp' });
    const teams = new TeamService();
    const create = new TeamCreateTool(teams, tr.scopeCtx);
    const engineTeam = new TeamTool(teams, tr.scopeCtx);
    await executable(create.resolveExecution({ name: 'core' })).execute(tr.context);
    const added = await executable(
      engineTeam.resolveExecution({ action: 'add_task', team_id: 'team-1', title: 'shared task' }),
    ).execute(tr.context);
    expect(added.isError).toBe(false);
    expect(teams.listTasks('team-1').map((task) => task.title)).toContain('shared task');
  });

  it('surfaces unknown team ids as tool errors', async () => {
    const tr = makeTestRuntime({ workDir: '/tmp' });
    const join = new TeamJoinTool(new TeamService(), tr.scopeCtx);
    const result = await executable(join.resolveExecution({ team_id: 'team-404' })).execute(tr.context);
    expect(result.isError).toBe(true);
    expect(output(result)).toContain('Team not found');
  });
});
