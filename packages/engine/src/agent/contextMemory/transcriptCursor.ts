/**
 * Read-only transcript cursor API for plugins (unified plan C2).
 *
 * A stable, cursor-based view over the durable wire journal: callers page by
 * sequence number with an optional agent filter, without mutating the session.
 * Reference: Claude `claude-code.d.ts:3288-3330` (`session.messages({last, after, agentId})`).
 */
export interface TranscriptEntry {
  readonly seq: number;
  readonly agentId: string;
  readonly role: string;
  readonly text: string;
}

export interface TranscriptQuery {
  readonly agentId?: string;
  readonly after?: number;
  readonly last?: number;
  readonly maxLast?: number;
}

export interface TranscriptPage {
  readonly messages: readonly TranscriptEntry[];
  readonly nextCursor: number | undefined;
  readonly hasMore: boolean;
}

export function queryTranscript(
  entries: readonly TranscriptEntry[],
  query: TranscriptQuery = {},
): TranscriptPage {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const filtered = query.agentId === undefined
    ? sorted
    : sorted.filter((entry) => entry.agentId === query.agentId);
  const after = query.after ?? -Infinity;
  const remaining = filtered.filter((entry) => entry.seq > after);
  const max = Math.max(1, Math.min(query.last ?? 50, query.maxLast ?? 200));
  const messages = remaining.slice(0, max);
  const hasMore = remaining.length > messages.length;
  const nextCursor = hasMore ? messages[messages.length - 1]?.seq : undefined;
  return { messages, nextCursor, hasMore };
}
