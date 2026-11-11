import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const TeamErrors = {
  codes: {
    TEAM_NOT_FOUND: 'team.not_found',
    TEAM_ALREADY_EXISTS: 'team.already_exists',
    TEAM_ID_EMPTY: 'team.id_empty',
    TEAM_NAME_EMPTY: 'team.name_empty',
    TEAM_AGENT_REQUIRED: 'team.agent_required',
    TEAM_MEMBER_EXISTS: 'team.member_exists',
    TEAM_MEMBER_NOT_FOUND: 'team.member_not_found',
    TEAM_TASK_NOT_FOUND: 'team.task_not_found',
    TEAM_TASK_ID_EMPTY: 'team.task_id_empty',
    TEAM_TASK_TITLE_EMPTY: 'team.task_title_empty',
    TEAM_TASK_ALREADY_CLAIMED: 'team.task_already_claimed',
    TEAM_TASK_TERMINAL: 'team.task_terminal',
    TEAM_TASK_ASSIGNEE_NOT_MEMBER: 'team.task_assignee_not_member',
    TEAM_INVALID_TRANSITION: 'team.invalid_transition',
    ARENA_TOO_FEW_CONTENDERS: 'arena.too_few_contenders',
    ARENA_CONTENDER_DUPLICATE: 'arena.contender_duplicate',
    ARENA_CONTENDER_INVALID: 'arena.contender_invalid',
    ARENA_PROMPT_EMPTY: 'arena.prompt_empty',
    BUDGET_NOT_FOUND: 'budget.not_found',
    BUDGET_ALREADY_SET: 'budget.already_set',
    BUDGET_INVALID: 'budget.invalid',
    BUDGET_EXHAUSTED: 'budget.exhausted',
    BUDGET_RESERVATION_NOT_FOUND: 'budget.reservation_not_found',
    BUDGET_RESERVATION_SETTLED: 'budget.reservation_settled',
    FORK_CACHE_KEY_INVALID: 'fork_cache.key_invalid',
  },
  retryable: ['budget.exhausted'],
} as const satisfies ErrorDomain;

registerErrorDomain(TeamErrors);
