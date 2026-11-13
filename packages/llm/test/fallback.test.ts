import { describe, expect, it } from 'vitest';

import { UNKNOWN_CAPABILITY } from '#/capability';
import { isFallbackEligibleError, meetsCapability, selectFallbackCandidate } from '#/fallback';

const toolCapability = { ...UNKNOWN_CAPABILITY, tool_use: true, max_context_tokens: 200_000 };

describe('provider fallback selection', () => {
  it('selects a compatible untried candidate for transient failures', () => {
    const selected = selectFallbackCandidate({
      primaryId: 'a',
      candidates: [
        { id: 'a', modelId: 'm-a', providerId: 'p-a', capability: toolCapability },
        { id: 'b', modelId: 'm-b', providerId: 'p-b', capability: toolCapability },
      ],
      error: { statusCode: 503 },
      triedIds: ['a'],
    });
    expect(selected?.id).toBe('b');
  });

  it('skips unavailable, incompatible, and unowned candidates', () => {
    const selected = selectFallbackCandidate({
      primaryId: 'a',
      candidates: [
        { id: 'b', modelId: 'm-b', providerId: 'p-b', capability: toolCapability, available: false },
        { id: 'c', modelId: 'm-c', providerId: 'p-c', capability: UNKNOWN_CAPABILITY },
        { id: 'd', modelId: 'm-d', providerId: 'p-d', capability: toolCapability, ownsModel: false },
        { id: 'e', modelId: 'm-e', providerId: 'p-e', capability: toolCapability, ownsModel: true },
      ],
      error: { statusCode: 429 },
      requiredCapability: toolCapability,
      requireModelOwnership: true,
    });
    expect(selected?.id).toBe('e');
  });

  it('does not fall back for aborts or non-retryable client errors', () => {
    expect(isFallbackEligibleError({ name: 'AbortError' })).toBe(false);
    expect(isFallbackEligibleError({ statusCode: 400 })).toBe(false);
    expect(isFallbackEligibleError({ statusCode: 401 })).toBe(true);
    expect(isFallbackEligibleError({ name: 'APIProviderQuotaExhaustedError' })).toBe(true);
  });

  it('requires candidate capabilities to cover the request', () => {
    expect(meetsCapability(toolCapability, UNKNOWN_CAPABILITY)).toBe(false);
    expect(meetsCapability(toolCapability, toolCapability)).toBe(true);
    expect(meetsCapability({ ...toolCapability, image_in: true }, toolCapability)).toBe(false);
  });

  it('returns undefined when no candidate remains', () => {
    expect(
      selectFallbackCandidate({
        primaryId: 'a',
        candidates: [{ id: 'a', modelId: 'm-a', providerId: 'p-a', capability: toolCapability }],
        error: { statusCode: 503 },
      }),
    ).toBeUndefined();
  });

  it('skips every model already tried in the chain and takes the next one', () => {
    const selected = selectFallbackCandidate({
      primaryId: 'a',
      candidates: [
        { id: 'a', modelId: 'm-a', providerId: 'p-a', capability: toolCapability },
        { id: 'b', modelId: 'm-b', providerId: 'p-b', capability: toolCapability },
        { id: 'c', modelId: 'm-c', providerId: 'p-c', capability: toolCapability },
      ],
      error: { statusCode: 429 },
      triedIds: ['a', 'b'],
    });
    expect(selected?.id).toBe('c');
  });

  it('returns undefined once the chain has tried every candidate', () => {
    expect(
      selectFallbackCandidate({
        primaryId: 'a',
        candidates: [
          { id: 'b', modelId: 'm-b', providerId: 'p-b', capability: toolCapability },
          { id: 'c', modelId: 'm-c', providerId: 'p-c', capability: toolCapability },
        ],
        error: { statusCode: 503 },
        triedIds: ['a', 'b', 'c'],
      }),
    ).toBeUndefined();
  });
});
