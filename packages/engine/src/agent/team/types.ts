export type TeamTaskStatus = 'open' | 'claimed' | 'completed' | 'cancelled';

export type TeamTaskPriority = 'low' | 'normal' | 'high';

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TeamMember {
  readonly teamId: string;
  readonly agentId: string;
  readonly role: string;
  readonly joinedAt: number;
}

export interface TeamTask {
  readonly id: string;
  readonly teamId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TeamTaskPriority;
  readonly status: TeamTaskStatus;
  readonly assigneeId: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly claimedAt: number | undefined;
  readonly completedAt: number | undefined;
}

export interface TeamSnapshot {
  readonly team: Team;
  readonly members: readonly TeamMember[];
  readonly tasks: readonly TeamTask[];
}

export interface CreateTeamInput {
  readonly id?: string;
  readonly name?: string;
}

export interface JoinTeamInput {
  readonly role?: string;
}

export interface AddTeamTaskInput {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: TeamTaskPriority;
}

export interface UpdateTeamTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: TeamTaskPriority;
  readonly status?: TeamTaskStatus;
  readonly assigneeId?: string | null;
}

export interface TeamTaskFilter {
  readonly status?: TeamTaskStatus;
  readonly assigneeId?: string;
}

export interface LeaveTeamResult {
  readonly member: TeamMember;
  readonly releasedTaskIds: readonly string[];
}

export interface TeamServiceOptions {
  readonly now?: () => number;
  readonly idFactory?: (kind: 'team' | 'task') => string;
}
