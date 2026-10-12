import type { AgentTaskStatus } from '@hilbras/omnicode-core/agent/task/types';
import type { QuestionTaskInfo } from '@hilbras/omnicode-core/agent/tools/ask-user-question/question-background-task';
import type { SubagentTaskInfo } from '@hilbras/omnicode-core/agent/tools/agent/subagent-task';
import type { ProcessTaskInfo } from '@hilbras/omnicode-core/agent/tools/os/bash/process-task';

export type BackgroundTaskStatus = AgentTaskStatus;

export type ProcessBackgroundTaskInfo = ProcessTaskInfo;

export type AgentBackgroundTaskInfo = SubagentTaskInfo;

export type QuestionBackgroundTaskInfo = QuestionTaskInfo;

export type BackgroundTaskInfo =
  | ProcessBackgroundTaskInfo
  | AgentBackgroundTaskInfo
  | QuestionBackgroundTaskInfo;
