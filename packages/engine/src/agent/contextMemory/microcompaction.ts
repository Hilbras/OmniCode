import { staleMessageIndices } from './contextMessageTimes';
import type { ContextMessage } from '#/agent/contextMemory/types';
import type { ContentPart } from '#human/llm/message';

export interface MicrocompactionOptions {
  readonly triggerTokens?: number;
  readonly targetTokens?: number;
  readonly keepRecentMessages?: number;
  readonly keepRecentUserMessages?: number;
  readonly placeholder?: string;
  /** Age gap in ms: stale older messages trigger eviction beside the token threshold. */
  readonly maxMessageAgeMs?: number;
  /** Per-message wall clock, keyed by message id. */
  readonly messageTimes?: Readonly<Record<string, number>>;
  readonly now?: number;
}

export interface MicrocompactionResult {
  readonly messages: readonly ContextMessage[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly evictedToolResults: number;
  readonly replacedMedia: number;
  readonly truncated: boolean;
  /**
   * Workspace paths whose Read tool results were evicted. The caller disarms
   * the file-read cache for them: the model can no longer see the content, so
   * a later write must be refused until it re-reads, instead of sailing
   * through on a fingerprint for content it cannot inspect.
   */
  readonly evictedReads: readonly string[];
}

export const DEFAULT_MICROCOMPACTION_TRIGGER_TOKENS = 120_000;
export const DEFAULT_MICROCOMPACTION_TARGET_TOKENS = 70_000;
export const DEFAULT_MICROCOMPACTION_KEEP_RECENT = 12;
export const DEFAULT_MICROCOMPACTION_KEEP_RECENT_USER_MESSAGES = 4;
export const MICROCOMPACTION_MAX_AGE_ENV_KEY = 'OMNICODE_MICROCOMPACTION_MAX_AGE_MS';
export const DEFAULT_MICROCOMPACTION_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_PLACEHOLDER = '[older tool result evicted by microcompaction]';

/** Age-gap trigger window; 0 (or `false`) disables it. Default: 30 minutes. */
export function resolveMicrocompactionMaxAgeMs(
  env: NodeJS.ProcessEnv | undefined = process.env,
): number {
  const raw = env?.[MICROCOMPACTION_MAX_AGE_ENV_KEY];
  if (raw === undefined) return DEFAULT_MICROCOMPACTION_MAX_AGE_MS;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MICROCOMPACTION_MAX_AGE_MS;
}

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
  const protectedIndices = protectedMessageIndices(messages, keepRecent, keepRecentUserMessages);
  const stale = staleMessageIndices(
    messages,
    options.messageTimes ?? {},
    options.now ?? Date.now(),
    options.maxMessageAgeMs ?? 0,
    keepRecent,
  ).filter((index) => !protectedIndices.has(index));
  const staleSet = new Set(stale);
  if (tokensBefore <= triggerTokens && stale.length === 0) {
    return {
      messages,
      tokensBefore,
      tokensAfter: tokensBefore,
      evictedToolResults: 0,
      replacedMedia: 0,
      truncated: false,
      evictedReads: [],
    };
  }

  const evictionOrder = [
    ...stale,
    ...messages.map((_message, index) => index).filter((index) => !staleSet.has(index)),
  ];
  let stalePending = stale.length;
  // Resolve evicted tool results back to the call that produced them: the
  // placeholder can then carry a refetch hint, and the caller can disarm the
  // file-read cache for Read results the model can no longer see.
  const toolInfo = new Map<string, { readonly name: string; readonly path?: string }>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      let path: string | undefined;
      try {
        const parsed: unknown = JSON.parse(call.arguments ?? '');
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const candidate = (parsed as Record<string, unknown>)['path'];
          if (typeof candidate === 'string') path = candidate;
        }
      } catch {
        /* a malformed argument string yields no refetch hint, not a failure */
      }
      toolInfo.set(call.id, path === undefined ? { name: call.name } : { name: call.name, path });
    }
  }
  const evictedReads: string[] = [];
  const output = [...messages];
  let tokensAfter = tokensBefore;
  let evictedToolResults = 0;
  let replacedMedia = 0;

  for (const index of evictionOrder) {
    if (tokensAfter <= targetTokens && stalePending === 0) break;
    if (protectedIndices.has(index)) continue;
    const message = output[index]!;
    const messagesPart = evictMessageParts(message, placeholder, toolInfo, evictedReads);
    if (messagesPart === undefined) continue;
    const delta = estimateContextTokens([message]) - estimateContextTokens([messagesPart.message]);
    if (delta <= 0) continue;
    output[index] = messagesPart.message;
    tokensAfter -= delta;
    evictedToolResults += messagesPart.toolResults;
    replacedMedia += messagesPart.media;
    if (staleSet.has(index)) stalePending -= 1;
  }

  return {
    messages: output,
    tokensBefore,
    tokensAfter: estimateContextTokens(output),
    evictedToolResults,
    replacedMedia,
    truncated: evictedToolResults > 0 || replacedMedia > 0,
    evictedReads,
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
  toolInfo: ReadonlyMap<string, { readonly name: string; readonly path?: string }> | undefined,
  evictedReads: string[],
): { readonly message: ContextMessage; readonly toolResults: number; readonly media: number } | undefined {
  if (message.role === 'tool') {
    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('');
    if (text === placeholder) return undefined;
    const info = message.toolCallId === undefined ? undefined : toolInfo?.get(message.toolCallId);
    if (info !== undefined && info.path !== undefined && (info.name === 'Read' || info.name === 'ReadMediaFile')) {
      evictedReads.push(info.path);
    }
    const body =
      placeholder === DEFAULT_PLACEHOLDER && info !== undefined
        ? `[older ${info.name} result evicted by microcompaction${info.path === undefined ? '' : `: re-read ${info.path} if needed`}]`
        : placeholder;
    return {
      message: { ...message, content: [{ type: 'text', text: body }] },
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
