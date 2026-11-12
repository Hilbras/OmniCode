import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { Error2, ErrorCodes } from '#/errors';
import { LifecycleScope } from '#/app/scopes';

import { TeamErrors } from './errors';
import type {
  AddTeamTaskInput,
  CreateTeamInput,
  JoinTeamInput,
  LeaveTeamResult,
  Team,
  TeamMember,
  TeamServiceOptions,
  TeamSnapshot,
  TeamTask,
  TeamTaskFilter,
  TeamTaskPriority,
  TeamTaskStatus,
  TeamState,
  UpdateTeamTaskInput,
} from './types';

export interface ITeamService {
  readonly _serviceBrand: undefined;

  createTeam(input?: CreateTeamInput): Team;
  getTeam(teamId: string): Team | undefined;
  listTeams(): readonly Team[];
  joinAgent(teamId: string, agentId: string, input?: JoinTeamInput): TeamMember;
  leaveAgent(teamId: string, agentId: string): LeaveTeamResult;
  listMembers(teamId: string): readonly TeamMember[];
  getMember(teamId: string, agentId: string): TeamMember | undefined;
  addTask(teamId: string, input: AddTeamTaskInput): TeamTask;
  updateTask(teamId: string, taskId: string, patch: UpdateTeamTaskInput): TeamTask;
  getTask(teamId: string, taskId: string): TeamTask | undefined;
  listTasks(teamId: string, filter?: TeamTaskFilter): readonly TeamTask[];
  claimTask(teamId: string, taskId: string, agentId: string): TeamTask;
  snapshot(teamId: string): TeamSnapshot;
}

export const ITeamService = createDecorator<ITeamService>('teamService');

const TASK_STATUSES: ReadonlySet<string> = new Set<TeamTaskStatus>([
  'open',
  'claimed',
  'completed',
  'cancelled',
]);

const TASK_PRIORITIES: ReadonlySet<string> = new Set<TeamTaskPriority>(['low', 'normal', 'high']);

function isTaskStatus(value: string): value is TeamTaskStatus {
  return TASK_STATUSES.has(value);
}

function isTaskPriority(value: string): value is TeamTaskPriority {
  return TASK_PRIORITIES.has(value);
}

function terminal(status: TeamTaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

function requiredText(value: string, code: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error2(code, `${field} must not be empty.`, { details: { field } });
  }
  return trimmed;
}

export class TeamService implements ITeamService {
  declare readonly _serviceBrand: undefined;

  private readonly now: () => number;
  private readonly idFactory: (kind: 'team' | 'task') => string;
  private sequence = 0;
  private readonly teams = new Map<string, Team>();
  private readonly members = new Map<string, Map<string, TeamMember>>();
  private readonly tasks = new Map<string, Map<string, TeamTask>>();
  private readonly persistence: TeamServiceOptions['persistence'];
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(options: TeamServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.persistence = options.persistence;
    this.idFactory =
      options.idFactory ??
      ((kind) => {
        this.sequence += 1;
        return `${kind}-${String(this.sequence)}`;
      });
  }

  async load(): Promise<void> {
    if (this.persistence === undefined) return;
    this.restoreState(await this.persistence.load());
  }

  async flush(): Promise<void> {
    await this.saveQueue;
  }

  exportState(): TeamState {
    return {
      teams: this.listTeams(),
      members: [...this.members.values()].flatMap((members) => [...members.values()]),
      tasks: [...this.tasks.values()].flatMap((tasks) => [...tasks.values()]),
    };
  }

  restoreState(state: TeamState): void {
    this.teams.clear();
    this.members.clear();
    this.tasks.clear();
    for (const team of state.teams) {
      this.teams.set(team.id, team);
      this.members.set(team.id, new Map());
      this.tasks.set(team.id, new Map());
    }
    for (const member of state.members) this.members.get(member.teamId)?.set(member.agentId, member);
    for (const task of state.tasks) this.tasks.get(task.teamId)?.set(task.id, task);
  }

  private queueSave(): void {
    if (this.persistence === undefined) return;
    const state = this.exportState();
    this.saveQueue = this.saveQueue.then(() => this.persistence?.save(state)).catch(() => undefined);
  }

  createTeam(input: CreateTeamInput = {}): Team {
    const id =
      input.id === undefined
        ? this.nextId('team', (candidate) => this.teams.has(candidate))
        : requiredText(input.id, TeamErrors.codes.TEAM_ID_EMPTY, 'Team id');
    if (this.teams.has(id)) {
      throw new Error2(TeamErrors.codes.TEAM_ALREADY_EXISTS, `Team already exists: ${id}`, {
        details: { teamId: id },
      });
    }
    const rawName = input.name === undefined ? undefined : input.name.trim();
    if (rawName !== undefined && rawName.length === 0) {
      throw new Error2(TeamErrors.codes.TEAM_NAME_EMPTY, 'Team name must not be empty.', {
        details: { teamId: id },
      });
    }
    const timestamp = this.now();
    const team: Team = {
      id,
      name: rawName ?? id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.teams.set(id, team);
    this.members.set(id, new Map());
    this.tasks.set(id, new Map());
    this.queueSave();
    return team;
  }

  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  listTeams(): readonly Team[] {
    return [...this.teams.values()].sort(
      (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  }

  joinAgent(teamId: string, agentId: string, input: JoinTeamInput = {}): TeamMember {
    this.requireTeam(teamId);
    const id = requiredText(agentId, TeamErrors.codes.TEAM_AGENT_REQUIRED, 'Agent id');
    const members = this.requireMembers(teamId);
    if (members.has(id)) {
      throw new Error2(
        TeamErrors.codes.TEAM_MEMBER_EXISTS,
        `Agent ${id} is already a member of team ${teamId}.`,
        { details: { teamId, agentId: id } },
      );
    }
    const role = requiredText(input.role ?? 'member', TeamErrors.codes.TEAM_AGENT_REQUIRED, 'Role');
    const member: TeamMember = {
      teamId,
      agentId: id,
      role,
      joinedAt: this.now(),
    };
    members.set(id, member);
    this.touchTeam(teamId);
    return member;
  }

  leaveAgent(teamId: string, agentId: string): LeaveTeamResult {
    this.requireTeam(teamId);
    const members = this.requireMembers(teamId);
    const member = members.get(agentId);
    if (member === undefined) {
      throw new Error2(
        TeamErrors.codes.TEAM_MEMBER_NOT_FOUND,
        `Agent ${agentId} is not a member of team ${teamId}.`,
        { details: { teamId, agentId } },
      );
    }
    members.delete(agentId);
    const releasedTaskIds = this.releaseTasksFor(teamId, agentId);
    this.touchTeam(teamId);
    return { member, releasedTaskIds };
  }

  listMembers(teamId: string): readonly TeamMember[] {
    this.requireTeam(teamId);
    return [...this.requireMembers(teamId).values()].sort(
      (left, right) =>
        left.joinedAt - right.joinedAt || left.agentId.localeCompare(right.agentId),
    );
  }

  getMember(teamId: string, agentId: string): TeamMember | undefined {
    return this.members.get(teamId)?.get(agentId);
  }

  addTask(teamId: string, input: AddTeamTaskInput): TeamTask {
    this.requireTeam(teamId);
    const tasks = this.requireTasks(teamId);
    const title = requiredText(input.title, TeamErrors.codes.TEAM_TASK_TITLE_EMPTY, 'Task title');
    const id =
      input.id === undefined
        ? this.nextId('task', (candidate) => tasks.has(candidate))
        : requiredText(input.id, TeamErrors.codes.TEAM_TASK_ID_EMPTY, 'Task id');
    if (tasks.has(id)) {
      throw new Error2(ErrorCodes.VALIDATION_FAILED, `Task already exists: ${id}`, {
        details: { teamId, taskId: id },
      });
    }
    const priority = input.priority ?? 'normal';
    if (!isTaskPriority(priority)) {
      throw new Error2(TeamErrors.codes.TEAM_INVALID_TRANSITION, `Unknown task priority: ${priority}`, {
        details: { teamId, taskId: id, priority },
      });
    }
    const timestamp = this.now();
    const task: TeamTask = {
      id,
      teamId,
      title,
      description: input.description ?? '',
      priority,
      status: 'open',
      assigneeId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      claimedAt: undefined,
      completedAt: undefined,
    };
    tasks.set(id, task);
    this.touchTeam(teamId);
    return task;
  }

  updateTask(teamId: string, taskId: string, patch: UpdateTeamTaskInput): TeamTask {
    this.requireTeam(teamId);
    const tasks = this.requireTasks(teamId);
    const current = tasks.get(taskId);
    if (current === undefined) {
      throw new Error2(TeamErrors.codes.TEAM_TASK_NOT_FOUND, `Task not found: ${taskId}`, {
        details: { teamId, taskId },
      });
    }
    const timestamp = this.now();
    const title =
      patch.title === undefined
        ? current.title
        : requiredText(patch.title, TeamErrors.codes.TEAM_TASK_TITLE_EMPTY, 'Task title');
    const description =
      patch.description === undefined ? current.description : (patch.description ?? '');
    const priority = patch.priority ?? current.priority;
    if (!isTaskPriority(priority)) {
      throw new Error2(TeamErrors.codes.TEAM_INVALID_TRANSITION, `Unknown task priority: ${priority}`, {
        details: { teamId, taskId, priority },
      });
    }
    if (patch.status !== undefined && !isTaskStatus(patch.status)) {
      throw new Error2(TeamErrors.codes.TEAM_INVALID_TRANSITION, `Unknown task status: ${patch.status}`, {
        details: { teamId, taskId, status: patch.status },
      });
    }

    let status: TeamTaskStatus = patch.status ?? current.status;
    let assigneeId =
      patch.assigneeId === undefined ? current.assigneeId : (patch.assigneeId ?? undefined);
    let claimedAt = current.claimedAt;
    let completedAt = current.completedAt;

    if (patch.status === undefined && patch.assigneeId !== undefined) {
      if (terminal(current.status)) {
        throw new Error2(
          TeamErrors.codes.TEAM_TASK_TERMINAL,
          `Task ${taskId} is ${current.status} and cannot be reassigned.`,
          { details: { teamId, taskId, status: current.status } },
        );
      }
      if (assigneeId === undefined) {
        status = 'open';
        claimedAt = undefined;
      } else {
        this.requireTaskAssignee(teamId, taskId, assigneeId);
        status = 'claimed';
        claimedAt ??= timestamp;
      }
    }

    if (patch.status !== undefined) {
      if (status === 'open') {
        if (assigneeId !== undefined) {
          throw new Error2(
            TeamErrors.codes.TEAM_INVALID_TRANSITION,
            `Open task ${taskId} cannot have an assignee.`,
            { details: { teamId, taskId } },
          );
        }
        claimedAt = undefined;
      }
      if (status === 'claimed') {
        if (assigneeId === undefined) {
          throw new Error2(
            TeamErrors.codes.TEAM_INVALID_TRANSITION,
            `Claimed task ${taskId} requires an assignee.`,
            { details: { teamId, taskId } },
          );
        }
        this.requireTaskAssignee(teamId, taskId, assigneeId);
        claimedAt ??= timestamp;
      }
    }

    if (terminal(status)) {
      completedAt ??= timestamp;
    } else {
      completedAt = undefined;
    }

    if (assigneeId !== undefined && !terminal(status)) {
      this.requireTaskAssignee(teamId, taskId, assigneeId);
    }

    const updated: TeamTask = {
      ...current,
      title,
      description,
      priority,
      status,
      assigneeId,
      updatedAt: timestamp,
      claimedAt,
      completedAt,
    };
    tasks.set(taskId, updated);
    this.touchTeam(teamId);
    return updated;
  }

  getTask(teamId: string, taskId: string): TeamTask | undefined {
    return this.tasks.get(teamId)?.get(taskId);
  }

  listTasks(teamId: string, filter: TeamTaskFilter = {}): readonly TeamTask[] {
    this.requireTeam(teamId);
    return [...this.requireTasks(teamId).values()]
      .filter((task) => filter.status === undefined || task.status === filter.status)
      .filter((task) => filter.assigneeId === undefined || task.assigneeId === filter.assigneeId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  claimTask(teamId: string, taskId: string, agentId: string): TeamTask {
    this.requireTeam(teamId);
    const id = requiredText(agentId, TeamErrors.codes.TEAM_AGENT_REQUIRED, 'Agent id');
    this.requireTaskAssignee(teamId, taskId, id);
    const tasks = this.requireTasks(teamId);
    const current = tasks.get(taskId);
    if (current === undefined) {
      throw new Error2(TeamErrors.codes.TEAM_TASK_NOT_FOUND, `Task not found: ${taskId}`, {
        details: { teamId, taskId },
      });
    }
    if (terminal(current.status)) {
      throw new Error2(
        TeamErrors.codes.TEAM_TASK_TERMINAL,
        `Task ${taskId} is ${current.status} and cannot be claimed.`,
        { details: { teamId, taskId, status: current.status } },
      );
    }
    if (current.assigneeId !== undefined && current.assigneeId !== id) {
      throw new Error2(
        TeamErrors.codes.TEAM_TASK_ALREADY_CLAIMED,
        `Task ${taskId} is already claimed by ${current.assigneeId}.`,
        { details: { teamId, taskId, assigneeId: current.assigneeId } },
      );
    }
    if (current.assigneeId === id && current.status === 'claimed') {
      return current;
    }
    const timestamp = this.now();
    const claimed: TeamTask = {
      ...current,
      status: 'claimed',
      assigneeId: id,
      updatedAt: timestamp,
      claimedAt: current.claimedAt ?? timestamp,
    };
    tasks.set(taskId, claimed);
    this.touchTeam(teamId);
    return claimed;
  }

  snapshot(teamId: string): TeamSnapshot {
    const team = this.requireTeam(teamId);
    return {
      team,
      members: this.listMembers(teamId),
      tasks: this.listTasks(teamId),
    };
  }

  private nextId(kind: 'team' | 'task', exists: (id: string) => boolean): string {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const candidate = this.idFactory(kind);
      if (!exists(candidate)) return candidate;
    }
    throw new Error2(ErrorCodes.VALIDATION_FAILED, `Unable to allocate a unique ${kind} id.`, {
      details: { kind },
    });
  }

  private requireTeam(teamId: string): Team {
    const team = this.teams.get(teamId);
    if (team === undefined) {
      throw new Error2(TeamErrors.codes.TEAM_NOT_FOUND, `Team not found: ${teamId}`, {
        details: { teamId },
      });
    }
    return team;
  }

  private requireMembers(teamId: string): Map<string, TeamMember> {
    const members = this.members.get(teamId);
    if (members === undefined) {
      throw new Error2(TeamErrors.codes.TEAM_NOT_FOUND, `Team not found: ${teamId}`, {
        details: { teamId },
      });
    }
    return members;
  }

  private requireTasks(teamId: string): Map<string, TeamTask> {
    const tasks = this.tasks.get(teamId);
    if (tasks === undefined) {
      throw new Error2(TeamErrors.codes.TEAM_NOT_FOUND, `Team not found: ${teamId}`, {
        details: { teamId },
      });
    }
    return tasks;
  }

  private requireTaskAssignee(teamId: string, taskId: string, agentId: string): void {
    if (this.getMember(teamId, agentId) === undefined) {
      throw new Error2(
        TeamErrors.codes.TEAM_TASK_ASSIGNEE_NOT_MEMBER,
        `Agent ${agentId} is not a member of team ${teamId}.`,
        { details: { teamId, taskId, agentId } },
      );
    }
  }

  private releaseTasksFor(teamId: string, agentId: string): readonly string[] {
    const tasks = this.requireTasks(teamId);
    const released: string[] = [];
    const timestamp = this.now();
    for (const [taskId, task] of tasks) {
      if (task.assigneeId !== agentId || task.status !== 'claimed') continue;
      tasks.set(taskId, {
        ...task,
        status: 'open',
        assigneeId: undefined,
        claimedAt: undefined,
        updatedAt: timestamp,
      });
      released.push(taskId);
    }
    return released;
  }

  private touchTeam(teamId: string): void {
    const team = this.requireTeam(teamId);
    this.teams.set(teamId, { ...team, updatedAt: this.now() });
    this.queueSave();
  }
}

registerScopedService(
  LifecycleScope.Session,
  ITeamService,
  TeamService,
  ScopeActivation.OnDemand,
  'team',
);
