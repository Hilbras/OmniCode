import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FLOOD_BACKOFF_MS,
  DeliveryLedger,
  MAX_DELIVERY_ATTEMPTS,
} from '#/features/notify/deliveryLedger';

describe('DeliveryLedger', () => {
  it('enqueues idempotently and claims with ownership', () => {
    const ledger = new DeliveryLedger();
    ledger.enqueue('d1', 'telegram', 'ref', 0);
    ledger.enqueue('d1', 'telegram', 'other-ref', 0);
    expect(ledger.list()).toHaveLength(1);
    expect(ledger.claim('d1', 'boot-a', 0).obligation?.owner).toBe('boot-a');
    expect(ledger.claim('d1', 'boot-b', 1).reason).toBe('owned by another worker');
  });

  it('acknowledges delivery and rejects further claims', () => {
    const ledger = new DeliveryLedger();
    ledger.enqueue('d1', 'telegram', 'ref', 0);
    ledger.claim('d1', 'boot-a', 0);
    ledger.acknowledge('d1');
    expect(ledger.claim('d1', 'boot-a', 100).reason).toBe('already delivered');
  });

  it('applies flood backoff and marks final failure', () => {
    const ledger = new DeliveryLedger();
    ledger.enqueue('d1', 'telegram', 'ref', 0);
    ledger.claim('d1', 'boot-a', 0);
    const retried = ledger.fail('d1', 100);
    expect(retried?.nextAttemptAt).toBe(100 + DEFAULT_FLOOD_BACKOFF_MS);
    expect(ledger.claim('d1', 'boot-a', 100 + DEFAULT_FLOOD_BACKOFF_MS).reason).toBe('claimed');

    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      const now = 1_000_000 + i * 1_000_000;
      ledger.claim('d1', 'boot-a', now);
      ledger.fail('d1', now);
    }
    expect(ledger.list()[0]?.status).toBe('failed');
  });

  it('reclaims stale obligations from a previous boot', () => {
    const ledger = new DeliveryLedger();
    ledger.enqueue('d1', 'telegram', 'ref', 0);
    ledger.claim('d1', 'boot-old', 0);
    expect(ledger.sweepStale('boot-new')).toEqual(['d1']);
    expect(ledger.claim('d1', 'boot-new', 1).obligation?.owner).toBe('boot-new');
  });
});
