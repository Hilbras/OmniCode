import type { ContextMessage } from '#/agent/contextMemory/types';
import type { Message } from '#/llm-adapter/contract/message';
import { estimateTokensForMessage } from '#/llm-adapter/contract/tokens';

export const TOOL_RESULT_CLEARING_TRIGGER_RATIO = 0.5;
export const TOOL_RESULT_CLEARING_KEEP_TOKENS = 20_000;
export const TOOL_RESULT_CLEARING_KEEP_RATIO = 0.15;
export const TOOL_RESULT_CLEARING_MIN_KEEP_RESULTS = 3;
export const TOOL_RESULT_CLEARING_MIN_RESULT_TOKENS = 250;
export const TOOL_RESULT_CLEARING_MIN_BATCH_TOKENS = 10_000;
export const TOOL_RESULT_CLEARING_MIN_BATCH_RATIO = 0.05;
const MAX_STUB_ARGUMENT_CHARS = 200;

export class ToolResultClearer {
  private readonly cleared = new Set<string>();

  constructor(
    private readonly estimateMessage: (message: Message) => number = estimateTokensForMessage,
  ) {}

  apply(messages: readonly ContextMessage[], maxContextTokens: number): readonly ContextMessage[] {
    this.forgetMissing(messages);
    let view = this.render(messages);
    if (maxContextTokens <= 0) return view;
    if (this.estimateAll(view) < maxContextTokens * TOOL_RESULT_CLEARING_TRIGGER_RATIO) return view;
    if (this.extend(messages, maxContextTokens)) view = this.render(messages);
    return view;
  }

  private extend(messages: readonly ContextMessage[], maxContextTokens: number): boolean {
    const keepTokens = Math.min(
      TOOL_RESULT_CLEARING_KEEP_TOKENS,
      Math.floor(maxContextTokens * TOOL_RESULT_CLEARING_KEEP_RATIO),
    );
    const minBatchTokens = Math.min(
      TOOL_RESULT_CLEARING_MIN_BATCH_TOKENS,
      Math.floor(maxContextTokens * TOOL_RESULT_CLEARING_MIN_BATCH_RATIO),
    );
    const candidates: string[] = [];
    let batchTokens = 0;
    let keptResults = 0;
    let keptTokens = 0;
    let protecting = true;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (message.role !== 'tool' || message.toolCallId === undefined) continue;
      if (this.cleared.has(message.toolCallId)) continue;
      const tokens = this.estimateMessage(message);
      if (protecting) {
        protecting =
          keptResults < TOOL_RESULT_CLEARING_MIN_KEEP_RESULTS || keptTokens + tokens <= keepTokens;
      }
      if (protecting) {
        keptResults++;
        keptTokens += tokens;
        continue;
      }
      if (tokens < TOOL_RESULT_CLEARING_MIN_RESULT_TOKENS) continue;
      if (!isTextOnly(message)) continue;
      candidates.push(message.toolCallId);
      batchTokens += tokens;
    }
    if (candidates.length === 0 || batchTokens < minBatchTokens) return false;
    for (const id of candidates) this.cleared.add(id);
    return true;
  }

  private render(messages: readonly ContextMessage[]): readonly ContextMessage[] {
    if (this.cleared.size === 0) return messages;
    const calls = new Map<string, { readonly name: string; readonly arguments: string | null }>();
    for (const message of messages) {
      for (const call of message.toolCalls) calls.set(call.id, call);
    }
    return messages.map((message) => {
      if (message.role !== 'tool' || message.toolCallId === undefined) return message;
      if (!this.cleared.has(message.toolCallId)) return message;
      const call = calls.get(message.toolCallId);
      return {
        ...message,
        content: [{ type: 'text', text: clearedStub(call, this.estimateMessage(message)) }],
      };
    });
  }

  private forgetMissing(messages: readonly ContextMessage[]): void {
    if (this.cleared.size === 0) return;
    const present = new Set<string>();
    for (const message of messages) {
      if (message.role === 'tool' && message.toolCallId !== undefined) present.add(message.toolCallId);
    }
    for (const id of this.cleared) {
      if (!present.has(id)) this.cleared.delete(id);
    }
  }

  private estimateAll(messages: readonly Message[]): number {
    let total = 0;
    for (const message of messages) total += this.estimateMessage(message);
    return total;
  }
}

function isTextOnly(message: Message): boolean {
  return message.content.every((part) => part.type === 'text');
}

function clearedStub(
  call: { readonly name: string; readonly arguments: string | null } | undefined,
  tokens: number,
): string {
  const args = call?.arguments ?? '';
  const shownArgs =
    args.length > MAX_STUB_ARGUMENT_CHARS ? `${args.slice(0, MAX_STUB_ARGUMENT_CHARS)}…` : args;
  const label = call === undefined ? 'tool call' : `${call.name}(${shownArgs})`;
  return `[Earlier tool result cleared to save context: ${label} returned about ${String(tokens)} tokens. Run the tool again if you need this output.]`;
}
