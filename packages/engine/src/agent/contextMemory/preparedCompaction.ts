/**
 * Prepared compaction with structural identity (unified plan A3).
 *
 * A summary compiled in the background is installed only if the message
 * sequence it was compiled from is still structurally identical. A new reply
 * interleaved during compilation invalidates the artifact instead of silently
 * dropping that reply. Reference: Hermes `agent/prepared_compaction.py:1-36`.
 */
import { createHash } from 'node:crypto';

export interface MessageIdentity {
  readonly id: string;
  readonly role: string;
  readonly contentHash: string;
}

export interface PreparedSummary {
  readonly fingerprint: string;
  readonly text: string;
  readonly compiledAt: number;
}

export type PreparedInstallDecision =
  | { readonly kind: 'install'; readonly reason: string }
  | { readonly kind: 'discard'; readonly reason: string }
  | { readonly kind: 'compile'; readonly reason: string };

export function structuralFingerprint(messages: readonly MessageIdentity[]): string {
  const canonical = messages
    .map((message) => `${message.role}\u0000${message.id}\u0000${message.contentHash}`)
    .join('\u0001');
  return createHash('sha256').update(canonical).digest('hex');
}

export function decidePreparedInstall(
  current: readonly MessageIdentity[],
  prepared: PreparedSummary | undefined,
  now: number,
  maxAgeMs: number,
): PreparedInstallDecision {
  if (current.length === 0) {
    return { kind: 'discard', reason: 'no messages to summarize' };
  }
  if (prepared === undefined) {
    return { kind: 'compile', reason: 'no prepared summary' };
  }
  if (now - prepared.compiledAt > maxAgeMs) {
    return { kind: 'discard', reason: 'prepared summary is too old' };
  }
  if (prepared.text.length === 0) {
    return { kind: 'discard', reason: 'prepared summary is empty' };
  }
  if (prepared.fingerprint !== structuralFingerprint(current)) {
    return { kind: 'discard', reason: 'message structure changed during compilation' };
  }
  return { kind: 'install', reason: 'structural identity matches' };
}
