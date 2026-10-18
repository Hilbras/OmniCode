import type { Message } from '#/llm/message';

export const UNANSWERED_TOOL_RESULT_TEXT =
  'No tool result was recorded for this call. The step was interrupted before it completed.';

export interface ToolHistoryRepair {
  readonly messages: readonly Message[];
  readonly repairedCallIds: readonly string[];
}

export function repairUnansweredToolCalls(messages: readonly Message[]): ToolHistoryRepair {
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      answered.add(message.toolCallId);
    }
  }
  const repairedCallIds: string[] = [];
  const repaired: Message[] = [];
  for (const message of messages) {
    repaired.push(message);
    if (message.role !== 'assistant') continue;
    const missing = message.toolCalls.filter((call) => !answered.has(call.id));
    if (missing.length === 0) continue;
    for (const call of missing) {
      repairedCallIds.push(call.id);
      repaired.push({
        role: 'tool',
        content: [{ type: 'text', text: UNANSWERED_TOOL_RESULT_TEXT }],
        toolCallId: call.id,
      });
    }
  }
  return { messages: repaired, repairedCallIds };
}

