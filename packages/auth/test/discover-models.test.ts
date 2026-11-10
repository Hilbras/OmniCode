import { describe, expect, it } from 'vitest';

import {
  applyDiscoveredModels,
  applyModelExclusions,
  applyProtocolOverrides,
  isExcludedModel,
  normalizeDiscoveryBaseUrl,
  buildModelsUrl,
  resolveProtocolOverride,
  type DiscoveredModelInfo,
  type ProtocolOverrideMap,
} from '../src/discover-models';
import { parseModelProtocol } from '../src/managed-omnicode';

describe('resolveProtocolOverride', () => {
  it('prefers an exact id over any glob', () => {
    const overrides: ProtocolOverrideMap = {
      'claude-*': 'anthropic',
      'claude-sonnet-4': 'openai',
    };
    expect(resolveProtocolOverride('claude-sonnet-4', overrides)).toBe('openai');
    expect(resolveProtocolOverride('claude-opus-4', overrides)).toBe('anthropic');
  });

  it('matches the longest prefix when globs overlap', () => {
    // Declaration order must not decide the winner: reordering a hand-written
    // table for readability would otherwise silently repoint a model.
    const a: ProtocolOverrideMap = { '*': 'openai', 'claude-*': 'anthropic' };
    const b: ProtocolOverrideMap = { 'claude-*': 'anthropic', '*': 'openai' };
    expect(resolveProtocolOverride('claude-sonnet-4', a)).toBe('anthropic');
    expect(resolveProtocolOverride('claude-sonnet-4', b)).toBe('anthropic');
    expect(resolveProtocolOverride('gpt-5', a)).toBe('openai');
    expect(resolveProtocolOverride('gpt-5', b)).toBe('openai');
  });

  it('returns undefined for an unmatched id and for no overrides', () => {
    expect(resolveProtocolOverride('gpt-5', { 'claude-*': 'anthropic' })).toBeUndefined();
    expect(resolveProtocolOverride('gpt-5', undefined)).toBeUndefined();
    expect(resolveProtocolOverride('gpt-5', {})).toBeUndefined();
  });

  it('does not treat a bare non-star key as a prefix', () => {
    expect(resolveProtocolOverride('claude-sonnet-4-5', { claude: 'anthropic' })).toBeUndefined();
  });

  it('resolves every wire the protocol parser now accepts', () => {
    for (const wire of ['anthropic', 'openai', 'google-genai', 'openai_responses'] as const) {
      expect(resolveProtocolOverride('m', { '*': wire })).toBe(wire);
    }
  });
});

describe('applyProtocolOverrides', () => {
  const models: readonly DiscoveredModelInfo[] = [{ id: 'claude-sonnet-4' }, { id: 'gpt-5' }];

  it('pins only the models a glob matches', () => {
    const out = applyProtocolOverrides(models, { 'claude-*': 'anthropic' });
    expect(out[0]).toEqual({ id: 'claude-sonnet-4', protocol: 'anthropic' });
    // Unmatched models must keep `protocol` absent so the alias falls back to
    // the provider's own wire rather than being pinned to something wrong.
    expect(out[1]).toEqual({ id: 'gpt-5' });
    expect('protocol' in (out[1] as object)).toBe(false);
  });

  it('returns the same array reference when nothing is declared', () => {
    expect(applyProtocolOverrides(models, undefined)).toBe(models);
    expect(applyProtocolOverrides(models, {})).toBe(models);
  });

  it('does not mutate the input', () => {
    applyProtocolOverrides(models, { '*': 'anthropic' });
    expect('protocol' in (models[0] as object)).toBe(false);
  });
});

describe('parseModelProtocol', () => {
  it('accepts every ProtocolSchema wire plus the managed endpoint spelling', () => {
    expect(parseModelProtocol('anthropic')).toBe('anthropic');
    expect(parseModelProtocol('openai')).toBe('openai');
    expect(parseModelProtocol('google-genai')).toBe('google-genai');
    expect(parseModelProtocol('omnicode')).toBe('omnicode');
    expect(parseModelProtocol('openai_responses')).toBe('openai_responses');
    expect(parseModelProtocol('response')).toBe('openai_responses');
  });

  it('rejects an unknown wire rather than guessing', () => {
    expect(parseModelProtocol('bedrock')).toBeUndefined();
    expect(parseModelProtocol(undefined)).toBeUndefined();
    expect(parseModelProtocol(42)).toBeUndefined();
  });
});

describe('applyDiscoveredModels protocol pin', () => {
  it('writes a declared protocol onto the alias', () => {
    const config: { models?: Record<string, unknown> } = {};
    applyDiscoveredModels(config, 'zen', [
      { id: 'claude-sonnet-4', protocol: 'anthropic' },
      { id: 'gpt-5' },
    ]);

    const models = config.models ?? {};
    expect(models['zen/claude-sonnet-4']).toMatchObject({
      provider: 'zen',
      model: 'claude-sonnet-4',
      protocol: 'anthropic',
    });
    expect('protocol' in (models['zen/gpt-5'] as object)).toBe(false);
  });

  it('survives a refresh that rediscovers the same model', () => {
    // The pin is remote-owned on the managed path but user-owned on the
    // discovery path, so a second refresh must not strip it.
    const config: { models?: Record<string, unknown> } = {};
    applyDiscoveredModels(config, 'zen', [{ id: 'claude-sonnet-4', protocol: 'anthropic' }]);
    applyDiscoveredModels(config, 'zen', [{ id: 'claude-sonnet-4', protocol: 'anthropic' }]);
    expect((config.models ?? {})['zen/claude-sonnet-4']).toMatchObject({
      protocol: 'anthropic',
    });
  });
});

describe('applyDiscoveredModels context size', () => {
  it('leaves maxContextSize absent when the endpoint declares none', () => {
    const config: { models?: Record<string, unknown> } = {};
    applyDiscoveredModels(config, 'zen', [{ id: 'bare-model' }]);

    const alias = config.models?.['zen/bare-model'] as { maxContextSize?: number };
    expect(alias.maxContextSize).toBeUndefined();
  });

  it('writes a declared maxContextSize onto the alias', () => {
    const config: { models?: Record<string, unknown> } = {};
    applyDiscoveredModels(config, 'zen', [{ id: 'big-model', maxContextSize: 200000 }]);

    const alias = config.models?.['zen/big-model'] as { maxContextSize?: number };
    expect(alias.maxContextSize).toBe(200000);
  });
});

describe('applyModelExclusions', () => {
  it('drops ids named exactly and ids matched by a prefix glob', () => {
    const models: DiscoveredModelInfo[] = [
      { id: 'big-pickle' },
      { id: 'mimo-v2.6-flash-free' },
      { id: 'claude-sonnet-5' },
    ];
    expect(applyModelExclusions(models, ['*-free', 'big-pickle']).map((m) => m.id)).toEqual([
      'claude-sonnet-5',
    ]);
  });

  it('leaves the list untouched when nothing is declared', () => {
    const models: DiscoveredModelInfo[] = [{ id: 'big-pickle' }, { id: 'gpt-5' }];
    expect(applyModelExclusions(models, undefined)).toBe(models);
    expect(applyModelExclusions(models, [])).toBe(models);
  });

  it('prunes an alias a previous refresh wrote for an excluded model', () => {
    // The point of filtering before the write: an entry that has since been
    // declared off-limits must disappear on the next refresh, not linger.
    const config: { models?: Record<string, unknown> } = {};
    applyDiscoveredModels(config, 'zen', [{ id: 'big-pickle' }, { id: 'gpt-5' }]);
    expect((config.models ?? {})['zen/big-pickle']).toBeDefined();

    applyDiscoveredModels(
      config,
      'zen',
      applyModelExclusions([{ id: 'big-pickle' }, { id: 'gpt-5' }], ['big-pickle']),
    );
    expect((config.models ?? {})['zen/big-pickle']).toBeUndefined();
    expect((config.models ?? {})['zen/gpt-5']).toBeDefined();
  });
});

describe('isExcludedModel', () => {
  it('requires an exact match when the pattern has no glob', () => {
    expect(isExcludedModel('big-pickle', ['big-pickle'])).toBe(true);
    expect(isExcludedModel('big-pickle-2', ['big-pickle'])).toBe(false);
  });

  it('treats a trailing star as a prefix and a leading star as a suffix', () => {
    expect(isExcludedModel('claude-sonnet-5', ['claude-*'])).toBe(true);
    expect(isExcludedModel('mimo-v2.6-flash-free', ['*-free'])).toBe(true);
    expect(isExcludedModel('not-really-free', ['*-free'])).toBe(true);
    expect(isExcludedModel('free-tier-gpt', ['*-free'])).toBe(false);
    expect(isExcludedModel('gpt-5', ['*-free'])).toBe(false);
  });

  it('ignores a declaration that is absent or empty', () => {
    expect(isExcludedModel('big-pickle', undefined)).toBe(false);
    expect(isExcludedModel('big-pickle', [])).toBe(false);
  });
});

describe('normalizeDiscoveryBaseUrl', () => {
  it('strips a pasted completions path and trailing slashes', () => {
    expect(normalizeDiscoveryBaseUrl('https://x.test/v1/chat/completions')).toBe(
      'https://x.test/v1',
    );
    expect(normalizeDiscoveryBaseUrl('https://x.test/v1///')).toBe('https://x.test/v1');
  });

  it('re-adds a version segment only when the base lacks it', () => {
    expect(buildModelsUrl('https://x.test')).toBe('https://x.test/models');
    expect(buildModelsUrl('https://x.test', 'v1')).toBe('https://x.test/v1/models');
    expect(buildModelsUrl('https://x.test/v1', 'v1')).toBe('https://x.test/v1/models');
  });
});
