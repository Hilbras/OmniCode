import type { ContextMessage } from '#/agent/contextMemory/types';
import type { ContentPart } from '#human/llm/message';

export interface MicrocompactionOptions {
  readonly triggerTokens?: number;
  readonly targetTokens?: number;
  readonly keepRecentMessages?: number;
  readonly keepRecentUserMessages?: number;
  readonly placeholder?: string;
}

export interface MicrocompactionResult {
  readonly messages: readonly ContextMessage[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly evictedToolResults: number;
  readonly replacedMedia: number;
  readonly truncated: boolean;
}

export const DEFAULT_MICROCOMPACTION_TRIGGER_TOKENS = 120_000;
export const DEFAULT_MICROCOMPACTION_TARGET_TOKENS = 70_000;
export const DEFAULT_MICROCOMPACTION_KEEP_RECENT = 12;
export const DEFAULT_MICROCOMPACTION_KEEP_RECENT_USER_MESSAGES = 4;
const DEFAULT_PLACEHOLDER = '[older tool result evicted by microcompaction]';

export function microcompactContext(
  messages: readonly ContextMessage[],
  options: MicrocompactionOptions = {},
): MicrocompactionResult {
  const triggerTokens = Math.max(options.triggerTokens ?? DEFAULT_MICROCOMPACTION_TRIGGER_TOKENS, 1);
  const targetTokens = Math.min(
    Math.max(options.targetTokens ?? DEFAULT_MICROCOMPACTION_TARGET_TOKENS, 1),
    triggerTokens,
  );
  const keepRecent = Math.max(options.keepRecentMessages ?? DEFAULT_MICROCOMPACTION_KEEP_RECENT, 0);
  const keepRecentUserMessages = Math.max(
    options.keepRecentUserMessages ?? DEFAULT_MICROCOMPACTION_KEEP_RECENT_USER_MESSAGES,
    0,
  );
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
  const tokensBefore = estimateContextTokens(messages);
  if (tokensBefore <= triggerTokens) {
    return {
      messages,
      tokensBefore,
      tokensAfter: tokensBefore,
      evictedToolResults: 0,
      replacedMedia: 0,
      truncated: false,
    };
  }

  const protectedIndices = protectedMessageIndices(messages, keepRecent, keepRecentUserMessages);
  const output = [...messages];
  let tokensAfter = tokensBefore;
  let evictedToolResults = 0;
  let replacedMedia = 0;

  for (let index = 0; index < output.length && tokensAfter > targetTokens; index += 1) {
    if (protectedIndices.has(index)) continue;
    const message = output[index]!;
    const messagesPart = evictMessageParts(message, placeholder);
    if (messagesPart === undefined) continue;
    const delta = estimateContextTokens([message]) - estimateContextTokens([messagesPart.message]);
    if (delta <= 0) continue;
    output[index] = messagesPart.message;
    tokensAfter -= delta;
    evictedToolResults += messagesPart.toolResults;
    replacedMedia += messagesPart.media;
  }

  return {
    messages: output,
    tokensBefore,
    tokensAfter: estimateContextTokens(output),
    evictedToolResults,
    replacedMedia,
    truncated: evictedToolResults > 0 || replacedMedia > 0,
  };
}

export function estimateContextTokens(messages: readonly ContextMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function estimateMessageTokens(message: ContextMessage): number {
  let chars = 0;
  let media = 0;
  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        chars += part.text.length;
        break;
      case 'think':
        chars += part.think.length;
        break;
      case 'image_url':
      case 'audio_url':
      case 'video_url':
        media += 1;
        break;
    }
  }
  for (const call of message.toolCalls) chars += call.name.length + (call.arguments?.length ?? 0);
  return Math.ceil(chars / 4) + media * 512;
}

function protectedMessageIndices(
  messages: readonly ContextMessage[],
  keepRecent: number,
  keepRecentUserMessages: number,
): ReadonlySet<number> {
  const protectedIndices = new Set<number>();
  for (let index = Math.max(0, messages.length - keepRecent); index < messages.length; index += 1) {
    protectedIndices.add(index);
  }
  let preservedUsers = 0;
  for (let index = messages.length - 1; index >= 0 && preservedUsers < keepRecentUserMessages; index -= 1) {
    if (messages[index]?.role === 'user') {
      protectedIndices.add(index);
      preservedUsers += 1;
    }
  }
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'system') protectedIndices.add(index);
  }
  return protectedIndices;
}

function evictMessageParts(
  message: ContextMessage,
  placeholder: string,
): { readonly message: ContextMessage; readonly toolResults: number; readonly media: number } | undefined {
  if (message.role === 'tool') {
    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('');
    if (text === placeholder) return undefined;
    return {
      message: { ...message, content: [{ type: 'text', text: placeholder }] },
      toolResults: 1,
      media: 0,
    };
  }
  let media = 0;
  const content: ContentPart[] = [];
  for (const part of message.content) {
    if (part.type === 'image_url' || part.type === 'audio_url' || part.type === 'video_url') {
      content.push({ type: 'text', text: `[${part.type} evicted by microcompaction]` });
      media += 1;
      continue;
    }
    content.push(part);
  }
  if (media === 0) return undefined;
  return { message: { ...message, content }, toolResults: 0, media };
}
