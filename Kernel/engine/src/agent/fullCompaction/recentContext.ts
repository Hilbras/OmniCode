import type { Message } from '#/llm-adapter/contract/message';

export const DEFAULT_KEEP_TOKENS = 15_000;
export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 1_250;
const EXCHANGE_JOIN_TOKENS = 1;

interface RecentEntry {
  readonly message: Message;
  readonly text: string;
  readonly index: number;
}

export function truncateToolOutput(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;

  let end = 0;
  let kept = 0;
  for (const char of value) {
    if (kept === maxChars) break;
    end += char.length;
    kept++;
  }
  return `${value.slice(0, end)}\n[truncated]`;
}

export function messageToText(message: Message, maxChars: number): string {
  switch (message.role) {
    case 'system':
      return '';

    case 'user': {
      const text = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('');
      return text ? `[User]: ${text}` : '';
    }

    case 'assistant': {
      const lines = message.content.flatMap((part) => {
        if (part.type === 'text') return [`[Assistant]: ${part.text}`];
        if (part.type === 'think') return part.think ? [`[Assistant reasoning]: ${part.think}`] : [];
        return [];
      });
      for (const call of message.toolCalls) {
        lines.push(`[Assistant tool call]: ${call.name}(${call.arguments ?? ''})`);
      }
      return lines.join('\n');
    }

    case 'tool': {
      const text = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('');
      return `[Tool result]: ${truncateToolOutput(text, maxChars)}`;
    }
  }
}

export function buildRecentContextText(
  messages: readonly Message[],
  keepTokens: number,
  maxChars: number,
  estimateText: (text: string) => number,
): string | undefined {
  const entries: RecentEntry[] = messages.flatMap((message, index) => {
    const text = messageToText(message, maxChars);
    return text ? [{ message, text, index }] : [];
  });
  if (entries.length === 0) return undefined;

  const budgeted = entries.filter((entry) => entry.message.role !== 'user');
  if (budgeted.length === 0) return undefined;

  let total = 0;
  let dropped = budgeted.length;
  while (dropped > 0) {
    const next = total + estimateText(budgeted[dropped - 1]!.text);
    if (next > keepTokens) break;
    total = next;
    dropped--;
  }
  dropped = Math.min(dropped, budgeted.length - 1);

  const boundary = lastUserIndexBefore(entries, budgeted[dropped]!.index);
  const kept = entries.filter(
    (entry) => entry.index > boundary && entry.message.role !== 'user',
  );
  if (kept.length === 0) return undefined;
  return kept.map((entry) => entry.text).join('\n\n');
}

export function flattenAndDropOldest(
  messages: readonly Message[],
  targetTokens: number,
  maxChars: number,
  estimateText: (text: string) => number,
): { readonly text: string; readonly omitted: number } | undefined {
  const exchanges: string[] = [];
  for (const message of messages) {
    const text = messageToText(message, maxChars);
    if (!text) continue;
    if (message.role === 'user' || exchanges.length === 0) exchanges.push(text);
    else exchanges[exchanges.length - 1] += `\n${text}`;
  }
  if (exchanges.length === 0) return undefined;

  const note = (omitted: number) =>
    omitted > 0 ? `[${omitted} older ${omitted === 1 ? 'exchange' : 'exchanges'} omitted]\n\n` : '';

  const room = targetTokens - estimateText(note(exchanges.length));

  let total = 0;
  let dropped = exchanges.length;
  while (dropped > 0) {
    const next = total + estimateText(exchanges[dropped - 1]!) + EXCHANGE_JOIN_TOKENS;
    if (next > room) break;
    total = next;
    dropped--;
  }

  const kept = exchanges.slice(dropped);
  if (kept.length === 0) return undefined;

  const omitted = exchanges.length - kept.length;
  return { text: note(omitted) + kept.join('\n\n'), omitted };
}

function lastUserIndexBefore(entries: readonly RecentEntry[], index: number): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.index >= index) continue;
    if (entry.message.role === 'user') return entry.index;
  }
  return -1;
}
