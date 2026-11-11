import { describe, expect, it } from 'vitest';

import { MEMORY_SCOPE_TIERS } from '#/contracts/memoryTypes';
import { scopeKeyFor } from '#/storage/memoryKeys';

describe('channel memory scope', () => {
  it('is a first-class scope tier', () => {
    expect(MEMORY_SCOPE_TIERS).toContain('channel');
  });

  it('derives a stable channel key and requires an id', () => {
    expect(scopeKeyFor({ tier: 'channel', channelId: 'telegram:42' })).toBe('c:telegram%3A42');
    expect(scopeKeyFor({ tier: 'channel' })).toBeUndefined();
  });
});
