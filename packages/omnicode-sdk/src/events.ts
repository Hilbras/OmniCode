import type {
  ApprovalRequest,
  ApprovalResponse,
  QuestionRequest,
  QuestionResult,
} from '#/interaction';

export type { OmnicodeErrorPayload } from '#/errors';

export type { Event, ToolResultEvent } from '@hilbras/omnicode-core/events';

export { MCP_OAUTH_AUTHORIZATION_URL_TOOL_UPDATE } from '@hilbras/omnicode-core/tool/toolContract';

export type { AgentStatusUpdatedEvent } from '@hilbras/omnicode-core/agent/usage/usageEvents';
export type { SessionMetaUpdatedEvent } from '@hilbras/omnicode-core/session/sessionMetadata/sessionMetaEvents';
export type { GoalUpdatedEvent } from '@hilbras/omnicode-core/features/goal/goalOps';
export type { SkillActivatedEvent } from '@hilbras/omnicode-core/features/skill/skillOps';
export type { PluginCommandActivatedEvent } from '@hilbras/omnicode-core/agent/pluginCommand/pluginCommand';
export type { ErrorEvent, WarningEvent } from '@hilbras/omnicode-core/errors';
export type { UsageStatus } from '@hilbras/omnicode-core/agent/usage/usage';

export type {
  TurnStartedEvent,
  TurnStepStartedEvent,
  TurnStepCompletedEvent,
  TurnStepRetryingEvent,
  TurnStepInterruptedEvent,
  TurnEndReason,
} from '@hilbras/omnicode-core/agent/loop/turnEvents';
export type { TurnEndedEvent } from '@hilbras/omnicode-core/agent/loop/turnOps';

export type {
  AssistantDeltaEvent,
  ThinkingDeltaEvent,
} from '@hilbras/omnicode-core/agent/loop/turnEvents';

export type { HookResultEvent } from '@hilbras/omnicode-core/features/externalHooks/agent/agentExternalHooksService';

export type {
  ToolCallStartedEvent,
  ToolCallDeltaEvent,
  ToolProgressEvent,
} from '@hilbras/omnicode-core/agent/toolExecutor/toolExecutorEvents';

export type { ToolUpdate } from '@hilbras/omnicode-core/tool/toolContract';
export type { McpOAuthAuthorizationUrlUpdateData } from '@hilbras/omnicode-core/agent/mcp/tools/auth';

export type { ToolCallRequest, ToolCallResponse } from '#/interaction';

export type {
  ToolListUpdatedEvent,
  McpServerStatusEvent,
} from '@hilbras/omnicode-core/agent/toolExecutor/toolExecutorEvents';
export type {
  ToolListUpdatedReason,
  McpServerStatusPayload,
} from '@hilbras/omnicode-core/agent/mcp/mcpEvents';

export type { ApprovalRequest, ApprovalScope } from '#/interaction';
export type { ApprovalDecision, ApprovalResponse } from '#/interaction';

export type { ToolInputDisplay } from '@hilbras/omnicode-core/tool/toolInputDisplay';

export type {
  QuestionRequest,
  QuestionItem,
  QuestionOption,
  QuestionAnswerMethod,
  QuestionAnswers,
  QuestionResponse,
  QuestionResult,
} from '#/interaction';

export type {
  SubagentSpawnedEvent,
  SubagentStartedEvent,
  SubagentCompletedEvent,
  SubagentFailedEvent,
  SubagentCancelledEvent,
} from '@hilbras/omnicode-core/session/subagent/mirrorAgentRun';
export type { SubagentSuspendedEvent } from '@hilbras/omnicode-core/features/swarm/session/sessionSwarmService';

export type {
  CompactionStartedEvent,
  CompactionBlockedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
} from '@hilbras/omnicode-core/agent/fullCompaction/compactionOps';
export type { CompactionResult } from '@hilbras/omnicode-core/agent/fullCompaction/types';

export type {
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
} from '@hilbras/omnicode-core/agent/task/types';

export type { CronFiredEvent } from '@hilbras/omnicode-core/features/cron/cronOps';

export type MaybePromise<T> = T | Promise<T>;

export type ApprovalHandler = (request: ApprovalRequest) => MaybePromise<ApprovalResponse>;

export type QuestionHandler = (request: QuestionRequest) => MaybePromise<QuestionResult>;
