import type {
  AgentTaskStatus,
  ProcessTaskInfo,
  QuestionTaskInfo,
} from '@hilbras/omnicode-core/agent/task/types';
import type { SubagentTaskInfo } from '@hilbras/omnicode-core/agent/tools/agent/subagent-task';

export type BackgroundTaskStatus = AgentTaskStatus;

export type ProcessBackgroundTaskInfo = ProcessTaskInfo;

export type AgentBackgroundTaskInfo = SubagentTaskInfo;

export type QuestionBackgroundTaskInfo = QuestionTaskInfo;

export type BackgroundTaskInfo =
  | ProcessBackgroundTaskInfo
  | AgentBackgroundTaskInfo
  | QuestionBackgroundTaskInfo;
