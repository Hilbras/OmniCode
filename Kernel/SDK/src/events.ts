import type {
  ApprovalRequest,
  ApprovalResponse,
  QuestionRequest,
  QuestionResult,
} from '#/interaction';

export type { OmnicodeErrorPayload } from '#/errors';

export type { Event, ToolResultEvent } from '@hilbras/omnicode-engine/events';

export { MCP_OAUTH_AUTHORIZATION_URL_TOOL_UPDATE } from '@hilbras/omnicode-engine/tool/toolContract';

export type { AgentStatusUpdatedEvent } from '@hilbras/omnicode-engine/agent/usage/usageEvents';
export type { SessionMetaUpdatedEvent } from '@hilbras/omnicode-engine/session/sessionMetadata/sessionMetaEvents';
export type { GoalUpdatedEvent } from '@hilbras/omnicode-engine/features/goal/goalOps';
export type { SkillActivatedEvent } from '@hilbras/omnicode-engine/features/skill/skillOps';
export type { PluginCommandActivatedEvent } from '@hilbras/omnicode-engine/agent/pluginCommand/pluginCommand';
export type { ErrorEvent, WarningEvent } from '@hilbras/omnicode-engine/errors';
export type { UsageStatus } from '@hilbras/omnicode-engine/agent/usage/usage';

export type {
  TurnStartedEvent,
  TurnStepStartedEvent,
  TurnStepCompletedEvent,
  TurnStepRetryingEvent,
  TurnStepInterruptedEvent,
  TurnEndReason,
} from '@hilbras/omnicode-engine/agent/loop/turnEvents';
export type { TurnEndedEvent } from '@hilbras/omnicode-engine/agent/loop/turnOps';

export type {
  AssistantDeltaEvent,
  ThinkingDeltaEvent,
} from '@hilbras/omnicode-engine/agent/loop/turnEvents';

export type { HookResultEvent } from '@hilbras/omnicode-engine/features/externalHooks/agent/agentExternalHooksService';

export type {
  ToolCallStartedEvent,
  ToolCallDeltaEvent,
  ToolProgressEvent,
} from '@hilbras/omnicode-engine/agent/toolExecutor/toolExecutorEvents';

export type { ToolUpdate } from '@hilbras/omnicode-engine/tool/toolContract';
export type { McpOAuthAuthorizationUrlUpdateData } from '@hilbras/omnicode-engine/agent/mcp/tools/auth';

export type { ToolCallRequest, ToolCallResponse } from '#/interaction';

export type {
  ToolListUpdatedEvent,
  McpServerStatusEvent,
} from '@hilbras/omnicode-engine/agent/toolExecutor/toolExecutorEvents';
export type {
  ToolListUpdatedReason,
  McpServerStatusPayload,
} from '@hilbras/omnicode-engine/agent/mcp/mcpEvents';

export type { ApprovalRequest, ApprovalScope } from '#/interaction';
export type { ApprovalDecision, ApprovalResponse } from '#/interaction';

export type { ToolInputDisplay } from '@hilbras/omnicode-engine/tool/toolInputDisplay';

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
} from '@hilbras/omnicode-engine/session/subagent/mirrorAgentRun';
export type { SubagentSuspendedEvent } from '@hilbras/omnicode-engine/features/swarm/session/sessionSwarmService';

export type {
  CompactionStartedEvent,
  CompactionBlockedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
} from '@hilbras/omnicode-engine/agent/fullCompaction/compactionOps';
export type { CompactionResult } from '@hilbras/omnicode-engine/agent/fullCompaction/types';

export type {
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
} from '@hilbras/omnicode-engine/agent/task/types';

export type { CronFiredEvent } from '@hilbras/omnicode-engine/features/cron/cronOps';

export type MaybePromise<T> = T | Promise<T>;

export type ApprovalHandler = (request: ApprovalRequest) => MaybePromise<ApprovalResponse>;

export type QuestionHandler = (request: QuestionRequest) => MaybePromise<QuestionResult>;
