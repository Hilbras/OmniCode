import { createHash } from 'node:crypto';

import type { ContextMessage } from '#/agent/contextMemory/types';
import type { Message } from '#/llm-adapter/contract/message';

const MIN_DEDUPE_CHARS = 400;
const MAX_POINTER_ARGS_CHARS = 200;

export interface ToolResultDedupeOutcome {
  readonly messages: readonly ContextMessage[];
  readonly replaced: number;
}

export function dedupeRepeatedToolResults(
  messages: readonly ContextMessage[],
): ToolResultDedupeOutcome {
  const labels = new Map<string, { readonly name: string; readonly arguments: string | null }>();
  for (const message of messages) {
    for (const call of message.toolCalls) labels.set(call.id, call);
  }
  const firstSeen = new Map<string, string>();
  let replaced = 0;
  const out: readonly ContextMessage[] = messages.map((message) => {
    if (message.role !== 'tool' || message.toolCallId === undefined) return message;
    if (!isPlainText(message)) return message;
    const text = plainTextOf(message);
    if (text.length < MIN_DEDUPE_CHARS) return message;
    const digest = digestOf(text);
    const firstId = firstSeen.get(digest);
    if (firstId === undefined) {
      firstSeen.set(digest, message.toolCallId);
      return message;
    }
    replaced += 1;
    return {
      ...message,
      content: [
        { type: 'text', text: duplicatePointer(labels.get(firstId), firstId, text.length) },
      ],
    };
  });
  return replaced === 0 ? { messages, replaced } : { messages: out, replaced };
}

function isPlainText(message: Message): boolean {
  return message.content.length > 0 && message.content.every((part) => part.type === 'text');
}

function plainTextOf(message: Message): string {
  let text = '';
  for (const part of message.content) {
    if (part.type === 'text') text += part.text;
  }
  return text;
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('base64');
}

function duplicatePointer(
  label: { readonly name: string; readonly arguments: string | null } | undefined,
  firstId: string,
  chars: number,
): string {
  const args = label?.arguments ?? '';
  const shownArgs =
    args.length > MAX_POINTER_ARGS_CHARS ? `${args.slice(0, MAX_POINTER_ARGS_CHARS)}…` : args;
  const call = label === undefined ? 'tool call' : `${label.name}(${shownArgs})`;
  return `[Identical to the earlier result of ${call} (tool call ${firstId}, ${String(chars)} chars): the same output already appears earlier in this conversation, so it is not repeated here. Read that earlier result instead, or run the tool again if it has left the context.]`;
}