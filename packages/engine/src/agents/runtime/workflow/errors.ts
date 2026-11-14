import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const WorkflowErrors = {
  codes: {
    WORKFLOW_INVALID_SCRIPT: 'workflow.invalid_script',
    WORKFLOW_INVALID_OPTIONS: 'workflow.invalid_options',
    WORKFLOW_JOURNAL_INVALID: 'workflow.journal_invalid',
    WORKFLOW_SCRIPT_MISMATCH: 'workflow.script_mismatch',
    WORKFLOW_ALREADY_RUNNING: 'workflow.already_running',
    WORKFLOW_TOOL_NOT_ALLOWED: 'workflow.tool_not_allowed',
    WORKFLOW_BUDGET_ESTIMATE_MISSING: 'workflow.budget_estimate_missing',
    WORKFLOW_BUDGET_EXHAUSTED: 'workflow.budget_exhausted',
    WORKFLOW_STALL_TIMEOUT: 'workflow.stall_timeout',
    WORKFLOW_STEP_FAILED: 'workflow.step_failed',
    WORKFLOW_DEADLOCKED: 'workflow.deadlocked',
    WORKFLOW_EXECUTOR_MISSING: 'workflow.executor_missing',
  },
  retryable: [],
} as const satisfies ErrorDomain;

registerErrorDomain(WorkflowErrors);
