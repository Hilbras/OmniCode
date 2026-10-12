import type { ToolInputDisplay } from '@hilbras/omnicode-core/tool/toolInputDisplay';
import type { ContentPart } from '@hilbras/omnicode-llm';

export type {
  ApprovalDecision,
  ApprovalResponse,
} from '@hilbras/omnicode-core/agent/interaction/approval';
export type {
  QuestionAnswerMethod,
  QuestionAnswers,
  QuestionItem,
  QuestionOption,
  QuestionRequest,
  QuestionResponse,
  QuestionResult,
} from '@hilbras/omnicode-core/agent/interaction/question';

export type ApprovalScope = 'session';

export interface ApprovalRequest {
  readonly turnId?: number | undefined;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly action: string;
  readonly display: ToolInputDisplay;
}

export interface ToolCallRequest {
  readonly turnId?: number | undefined;
  readonly toolCallId: string;
  readonly args: unknown;
}

export interface ToolCallResponse {
  readonly output: string | ContentPart[];
  readonly isError?: boolean | undefined;
}
