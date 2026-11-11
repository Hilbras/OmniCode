import type { MemoryRecord, MemorySensitivity } from '#/contracts/memoryTypes';

export type MemoryEgressCapability = 'provider:transmit';

export interface MemoryEgressRequest {
  readonly record: Pick<MemoryRecord, 'sensitivity'>;
  readonly capabilities: ReadonlySet<MemoryEgressCapability>;
}

export function canTransmitToProvider(request: MemoryEgressRequest): boolean {
  if (request.record.sensitivity === 'secret') return false;
  return request.capabilities.has('provider:transmit');
}

export function sensitivityAtMost(
  record: Pick<MemoryRecord, 'sensitivity'>,
  ceiling: MemorySensitivity,
): boolean {
  const rank: Record<MemorySensitivity, number> = {
    public: 0,
    internal: 1,
    confidential: 2,
    secret: 3,
  };
  return rank[record.sensitivity] <= rank[ceiling];
}
