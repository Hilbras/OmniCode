import type { PermissionPolicy, PermissionPolicyResult } from '#/agent/permissionPolicy/types';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';

const DEFAULT_APPROVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'SetTodoList',
  'TodoList',
  'TaskList',
  'TaskOutput',
  'WaitFor',
  'CronList',
  'WebSearch',
  'FetchURL',
  'Agent',
  'AgentSwarm',
  'AskUserQuestion',
  'NotifyUser',
  'Skill',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'select_tools',
  'memory_search',
  'memory_save',
  'memory_forget',
  'memory_manage',
  'Arena',
  'Lsp',
  'WorktreeList',
  'TaskBoardCreate',
  'TaskBoardUpdate',
  'TaskBoardList',
  'Team',
  'TeamCreate',
  'TeamJoin',
  'TeamLeave',
  'TeamList',
  'ArtifactRecord',
  'SourceRecord',
]);

export class DefaultToolApprovePermissionPolicyService implements PermissionPolicy {
  readonly name = 'default-tool-approve';

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    return DEFAULT_APPROVE_TOOLS.has(context.toolCall.name) ? { kind: 'approve' } : undefined;
  }
}
