import { describe, expect, it } from 'vitest';

import {
  capabilityCovers,
  capabilityScore,
  declaresProviderOwnership,
  selectOrderedFallback,
  type FallbackCandidate,
} from '#/agent/usage/fallbackChain';
import type { ModelCapability } from '#/llm-adapter/contract/capability';

const toolModel: ModelCapability = {
  image_in: false,
  video_in: false,
  audio_in: false,
  thinking: false,
  tool_use: true,
  max_context_tokens: 200_000,
};

function candidate(
  alias: string,
  overrides: Partial<FallbackCandidate> = {},
): FallbackCandidate {
  return {
    alias,
    providerName: `provider-${alias}`,
    capability: toolModel,
    owned: true,
    ...overrides,
  };
}

describe('declaresProviderOwnership', () => {
  it('accepts an explicit provider or endpoint and rejects a bare record', () => {
    expect(declaresProviderOwnership({ providerId: 'p' })).toBe(true);
    expect(declaresProviderOwnership({ provider: 'p' })).toBe(true);
    expect(declaresProviderOwnership({ baseUrl: 'https://example.test' })).toBe(true);
    expect(declaresProviderOwnership({ providerId: '  ' })).toBe(false);
    expect(declaresProviderOwnership({})).toBe(false);
  });
});

describe('capability coverage', () => {
  it('rejects capability loss but tolerates an unknown candidate context window', () => {
    expect(capabilityCovers(toolModel, { ...toolModel, tool_use: false })).toBe(false);
    expect(capabilityCovers({ ...toolModel, image_in: true }, toolModel)).toBe(false);
    expect(capabilityCovers(toolModel, { ...toolModel, max_context_tokens: 0 })).toBe(true);
    expect(capabilityCovers(toolModel, { ...toolModel, max_context_tokens: 100_000 })).toBe(false);
  });

  it('scores known coverage above unknown coverage', () => {
    const required = { ...toolModel, max_input_tokens: 100_000 };
    expect(capabilityScore(required, toolModel)).toBe(3);
    expect(
      capabilityScore(required, {
        ...toolModel,
        max_context_tokens: 0,
        max_input_tokens: undefined,
      }),
    ).toBe(1);
  });
});

describe('selectOrderedFallback', () => {
  it('selects the first eligible candidate in configuration order', () => {
    const selection = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [candidate('primary'), candidate('b'), candidate('c')],
    });

    expect(selection.status).toBe('selected');
    expect(selection.selected).toBe('b');
    expect(selection.tried).toEqual(['primary']);
    expect(selection.verdicts.map((verdict) => verdict.alias)).toEqual(['primary', 'b', 'c']);
    expect(selection.verdicts[0]?.rejections).toEqual(['already-tried']);
  });

  it('ranks known capability coverage above an unknown window', () => {
    const required = { ...toolModel, max_input_tokens: 100_000 };
    const unknown = candidate('unknown-window', {
      capability: { ...toolModel, max_context_tokens: 0 },
    });
    const selection = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: required,
      candidates: [unknown, candidate('known-window')],
    });

    expect(selection.selected).toBe('known-window');
    expect(selection.verdicts[0]?.eligible).toBe(true);
    expect(selection.verdicts[0]?.capabilityScore).toBe(1);
    expect(selection.verdicts[1]?.capabilityScore).toBe(3);
  });

  it('never selects a model that is already in the chain', () => {
    const selection = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [candidate('b'), candidate('c')],
      triedAliases: ['b'],
    });

    expect(selection.selected).toBe('c');
    expect(selection.tried).toEqual(['b', 'primary']);
  });

  it('rejects capability loss instead of degrading the request', () => {
    const selection = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [
        candidate('no-tools', { capability: { ...toolModel, tool_use: false } }),
        candidate('small', { capability: { ...toolModel, max_context_tokens: 8_000 } }),
      ],
    });

    expect(selection.status).toBe('exhausted');
    expect(selection.selected).toBeUndefined();
    expect(selection.verdicts.map((verdict) => verdict.rejections)).toEqual([
      ['capability-mismatch'],
      ['capability-mismatch'],
    ]);
  });

  it('requires ownership by default and ranks owned candidates first when it does not', () => {
    const required = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [candidate('unowned', { owned: false }), candidate('owned', { owned: true })],
    });
    expect(required.selected).toBe('owned');
    expect(required.verdicts[0]?.rejections).toEqual(['not-owned']);

    const optional = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [candidate('unowned', { owned: false }), candidate('owned', { owned: true })],
      requireOwnership: false,
    });
    expect(optional.selected).toBe('owned');
    expect(optional.verdicts[0]?.rejections).toEqual([]);
  });

  it('skips a provider whose quota circuit is open', () => {
    const selection = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [
        candidate('cooling-down', { circuitOpen: true }),
        candidate('healthy', { circuitOpen: false }),
      ],
    });

    expect(selection.selected).toBe('healthy');
    expect(selection.verdicts[0]?.rejections).toEqual(['circuit-open']);
  });

  it('treats a repeated alias as already tried', () => {
    const selection = selectOrderedFallback({
      primaryAlias: 'primary',
      requiredCapability: toolModel,
      candidates: [candidate('b'), candidate('b')],
    });

    expect(selection.selected).toBe('b');
    expect(selection.verdicts[1]?.rejections).toEqual(['already-tried']);
  });

  it('walks a chain once and terminates without revisiting a model', () => {
    const pool = [candidate('b'), candidate('c'), candidate('a')];
    const tried: string[] = [];
    const visits: string[] = [];

    for (;;) {
      const selection = selectOrderedFallback({
        primaryAlias: 'a',
        requiredCapability: toolModel,
        candidates: pool,
        triedAliases: tried,
      });
      if (selection.selected === undefined) {
        expect(selection.status).toBe('exhausted');
        break;
      }
      visits.push(selection.selected);
      tried.push(selection.selected);
      expect(visits.length).toBeLessThanOrEqual(pool.length);
    }

    expect(visits).toEqual(['b', 'c']);
  });
});