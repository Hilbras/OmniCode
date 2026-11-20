/**
 * Delivery-obligation ledger (unified plan C3).
 *
 * At-least-once external delivery with ownership stamps, bounded attempts and
 * flood backoff; a boot sweep reclaims obligations left by a previous process.
 * Reference: Hermes `gateway/delivery_ledger.py:230-393`.
 */
export type DeliveryStatus = 'pending' | 'claimed' | 'delivered' | 'failed';

export interface DeliveryObligation {
  readonly id: string;
  readonly channel: string;
  readonly payloadRef: string;
  readonly createdAt: number;
  readonly attempts: number;
  readonly owner: string | undefined;
  readonly nextAttemptAt: number;
  readonly status: DeliveryStatus;
}

export interface ClaimResult {
  readonly obligation: DeliveryObligation | undefined;
  readonly reason: string;
}

export const DEFAULT_FLOOD_BACKOFF_MS = 30_000;
export const MAX_DELIVERY_ATTEMPTS = 5;

export class DeliveryLedger {
  private readonly obligations = new Map<string, DeliveryObligation>();

  enqueue(id: string, channel: string, payloadRef: string, now: number): DeliveryObligation {
    if (this.obligations.has(id)) return this.obligations.get(id)!;
    const obligation: DeliveryObligation = {
      id, channel, payloadRef, createdAt: now, attempts: 0,
      owner: undefined, nextAttemptAt: now, status: 'pending',
    };
    this.obligations.set(id, obligation);
    return obligation;
  }

  claim(id: string, owner: string, now: number): ClaimResult {
    const current = this.obligations.get(id);
    if (current === undefined) return { obligation: undefined, reason: 'unknown obligation' };
    if (current.status === 'delivered') return { obligation: undefined, reason: 'already delivered' };
    if (current.status === 'claimed' && current.owner !== undefined && current.owner !== owner) {
      return { obligation: undefined, reason: 'owned by another worker' };
    }
    if (current.nextAttemptAt > now) {
      return { obligation: undefined, reason: 'flood backoff active' };
    }
    const claimed: DeliveryObligation = {
      ...current, owner, attempts: current.attempts + 1, status: 'claimed',
    };
    this.obligations.set(id, claimed);
    return { obligation: claimed, reason: 'claimed' };
  }

  acknowledge(id: string): void {
    const current = this.obligations.get(id);
    if (current === undefined) return;
    this.obligations.set(id, { ...current, status: 'delivered', owner: undefined });
  }

  fail(id: string, now: number): DeliveryObligation | undefined {
    const current = this.obligations.get(id);
    if (current === undefined) return undefined;
    if (current.attempts >= MAX_DELIVERY_ATTEMPTS) {
      const failed: DeliveryObligation = { ...current, status: 'failed', owner: undefined };
      this.obligations.set(id, failed);
      return failed;
    }
    const backoff = DEFAULT_FLOOD_BACKOFF_MS * current.attempts;
    const retry: DeliveryObligation = {
      ...current, status: 'pending', owner: undefined, nextAttemptAt: now + backoff,
    };
    this.obligations.set(id, retry);
    return retry;
  }

  sweepStale(bootOwner: string): readonly string[] {
    const reclaimed: string[] = [];
    for (const [id, obligation] of this.obligations) {
      if (obligation.status === 'claimed' && obligation.owner !== bootOwner) {
        this.obligations.set(id, { ...obligation, status: 'pending', owner: undefined });
        reclaimed.push(id);
      }
    }
    return reclaimed;
  }

  list(): readonly DeliveryObligation[] {
    return [...this.obligations.values()];
  }
}
