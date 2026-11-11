import { describe, expect, it } from 'vitest';

import { TeamErrors } from '#/agent/team/errors';
import { TeamService } from '#/agent/team/teamService';

function clock(start = 1_000): () => number {
  let value = start;
  return () => {
    value += 10;
    return value;
  };
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  }
  return '';
}

describe('TeamService', () => {
  it('creates teams and members with deterministic ids and timestamps', () => {
    const teams = new TeamService({ now: clock(), idFactory: (kind) => `${kind}-x` });
    const team = teams.createTeam({ name: 'alpha' });
    expect(team).toMatchObject({ id: 'team-x', name: 'alpha', createdAt: 1010, updatedAt: 1010 });

    const member = teams.joinAgent(team.id, 'agent-a', { role: 'lead' });
    expect(member).toMatchObject({ teamId: 'team-x', agentId: 'agent-a', role: 'lead' });
    expect(teams.listMembers(team.id)).toHaveLength(1);
    expect(teams.getMember(team.id, 'agent-a')).toEqual(member);
    expect(teams.getMember(team.id, 'missing')).toBeUndefined();
  });

  it('rejects duplicate teams, members, and missing teams explicitly', () => {
    const teams = new TeamService();
    teams.createTeam({ id: 'team-1' });
    expect(errorCode(() => teams.createTeam({ id: 'team-1' }))).toBe(
      TeamErrors.codes.TEAM_ALREADY_EXISTS,
    );
    teams.joinAgent('team-1', 'agent-a');
    expect(errorCode(() => teams.joinAgent('team-1', 'agent-a'))).toBe(
      TeamErrors.codes.TEAM_MEMBER_EXISTS,
    );
    expect(errorCode(() => teams.joinAgent('missing', 'agent-a'))).toBe(
      TeamErrors.codes.TEAM_NOT_FOUND,
    );
    expect(errorCode(() => teams.leaveAgent('team-1', 'agent-b'))).toBe(
      TeamErrors.codes.TEAM_MEMBER_NOT_FOUND,
    );
  });

  it('supports shared task add, update, list, and atomic claim', () => {
    const teams = new TeamService();
    teams.createTeam({ id: 'team-1' });
    teams.joinAgent('team-1', 'agent-a');
    teams.joinAgent('team-1', 'agent-b');

    const first = teams.addTask('team-1', {
      id: 'task-1',
      title: 'write tests',
      priority: 'high',
    });
    expect(first).toMatchObject({ status: 'open', priority: 'high', assigneeId: undefined });

    const claimed = teams.claimTask('team-1', 'task-1', 'agent-a');
    expect(claimed).toMatchObject({ status: 'claimed', assigneeId: 'agent-a' });
    expect(teams.claimTask('team-1', 'task-1', 'agent-a')).toEqual(claimed);
    expect(errorCode(() => teams.claimTask('team-1', 'task-1', 'agent-b'))).toBe(
      TeamErrors.codes.TEAM_TASK_ALREADY_CLAIMED,
    );

    const updated = teams.updateTask('team-1', 'task-1', { status: 'completed' });
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeTypeOf('number');
    expect(errorCode(() => teams.claimTask('team-1', 'task-1', 'agent-b'))).toBe(
      TeamErrors.codes.TEAM_TASK_TERMINAL,
    );

    teams.addTask('team-1', { id: 'task-2', title: 'second' });
    expect(teams.listTasks('team-1')).toHaveLength(2);
    expect(teams.listTasks('team-1', { status: 'completed' }).map((task) => task.id)).toEqual([
      'task-1',
    ]);
    expect(teams.listTasks('team-1', { assigneeId: 'agent-a' })).toHaveLength(1);
  });

  it('releases claims when a member leaves and keeps the task list usable', () => {
    const teams = new TeamService({ now: clock() });
    teams.createTeam({ id: 'team-1' });
    teams.joinAgent('team-1', 'agent-a');
    teams.joinAgent('team-1', 'agent-b');
    teams.addTask('team-1', { id: 'task-1', title: 'shared' });
    teams.claimTask('team-1', 'task-1', 'agent-b');

    const left = teams.leaveAgent('team-1', 'agent-b');
    expect(left.member.agentId).toBe('agent-b');
    expect(left.releasedTaskIds).toEqual(['task-1']);
    const task = teams.getTask('team-1', 'task-1');
    expect(task).toMatchObject({ status: 'open', assigneeId: undefined, claimedAt: undefined });
    expect(teams.listMembers('team-1').map((member) => member.agentId)).toEqual(['agent-a']);
  });

  it('rejects invalid task assignments and unknown tasks', () => {
    const teams = new TeamService();
    teams.createTeam({ id: 'team-1' });
    teams.joinAgent('team-1', 'agent-a');
    teams.addTask('team-1', { id: 'task-1', title: 'shared' });

    expect(errorCode(() => teams.claimTask('team-1', 'task-1', 'ghost'))).toBe(
      TeamErrors.codes.TEAM_TASK_ASSIGNEE_NOT_MEMBER,
    );
    expect(
      errorCode(() => teams.updateTask('team-1', 'task-1', { assigneeId: 'ghost' })),
    ).toBe(TeamErrors.codes.TEAM_TASK_ASSIGNEE_NOT_MEMBER);
    expect(errorCode(() => teams.updateTask('team-1', 'missing', { title: 'x' }))).toBe(
      TeamErrors.codes.TEAM_TASK_NOT_FOUND,
    );
    expect(errorCode(() => teams.addTask('team-1', { title: '   ' }))).toBe(
      TeamErrors.codes.TEAM_TASK_TITLE_EMPTY,
    );
  });

  it('returns a complete snapshot', () => {
    const teams = new TeamService();
    teams.createTeam({ id: 'team-1', name: 'snapshot' });
    teams.joinAgent('team-1', 'agent-a');
    teams.addTask('team-1', { id: 'task-1', title: 'shared' });
    const snapshot = teams.snapshot('team-1');
    expect(snapshot.team.name).toBe('snapshot');
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.tasks).toHaveLength(1);
  });
});
