import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { FileTeamPersistence } from '#/agent/team/teamPersistence';
import { TeamService } from '#/agent/team/teamService';

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-team-'));
  dirs.push(dir);
  return join(dir, 'teams.json');
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('team persistence', () => {
  it('persists teams, members, and shared tasks', async () => {
    const file = await tempFile();
    const service = new TeamService({ persistence: new FileTeamPersistence(file) });
    const team = service.createTeam({ name: 'core' });
    service.joinAgent(team.id, 'agent-a');
    const task = service.addTask(team.id, { title: 'shared work' });
    service.claimTask(team.id, task.id, 'agent-a');
    await service.flush();

    const reloaded = new TeamService({ persistence: new FileTeamPersistence(file) });
    await reloaded.load();

    expect(reloaded.listTeams()).toHaveLength(1);
    expect(reloaded.listMembers(team.id).map((member) => member.agentId)).toEqual(['agent-a']);
    expect(reloaded.listTasks(team.id)).toMatchObject([
      { id: task.id, title: 'shared work', status: 'claimed', assigneeId: 'agent-a' },
    ]);
  });

  it('loads an empty state when the file does not exist', async () => {
    const file = await tempFile();
    const service = new TeamService({ persistence: new FileTeamPersistence(file) });
    await service.load();
    expect(service.listTeams()).toEqual([]);
  });

  it('round-trips state through export/restore', () => {
    const service = new TeamService();
    const team = service.createTeam({ name: 'core' });
    service.joinAgent(team.id, 'agent-a');
    service.addTask(team.id, { title: 'task' });
    const state = service.exportState();

    const restored = new TeamService();
    restored.restoreState(state);
    expect(restored.snapshot(team.id).members).toHaveLength(1);
    expect(restored.snapshot(team.id).tasks).toHaveLength(1);
  });
});
