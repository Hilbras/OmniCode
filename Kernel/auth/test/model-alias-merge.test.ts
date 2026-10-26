import { describe, expect, it } from 'vitest';

import {
  CUSTOM_REGISTRY_MODEL_FIELDS,
  MANAGED_OMNICODE_MODEL_FIELDS,
  mergeRefreshedModelAlias,
} from '../src/model-alias-merge';

describe('mergeRefreshedModelAlias', () => {
  it('preserves overrides while refreshing managed fields', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'managed:omnicode',
        model: 'omnicode-k2',
        maxContextSize: 262144,
        supportEfforts: ['low'],
        overrides: { supportEfforts: ['low'] },
      },
      {
        provider: 'managed:omnicode',
        model: 'omnicode-k2',
        maxContextSize: 262144,
        supportEfforts: ['low', 'high', 'max'],
      },
      MANAGED_OMNICODE_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(merged.overrides).toEqual({ supportEfforts: ['low'] });
  });

  it('drops managed top-level fields when upstream stops declaring them', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'managed:omnicode',
        model: 'omnicode-k2',
        maxContextSize: 262144,
        supportEfforts: ['low'],
      },
      {
        provider: 'managed:omnicode',
        model: 'omnicode-k2',
        maxContextSize: 262144,
      },
      MANAGED_OMNICODE_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toBeUndefined();
  });

  it('refreshes custom-registry supportEfforts from upstream', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
        supportEfforts: ['low', 'high'],
      },
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
        supportEfforts: ['low', 'high', 'max'],
        defaultEffort: 'high',
      },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(merged.defaultEffort).toBe('high');
  });

  it('drops custom-registry effort fields when upstream stops declaring them', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
        supportEfforts: ['low', 'high'],
        defaultEffort: 'high',
      },
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
      },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toBeUndefined();
    expect(merged.defaultEffort).toBeUndefined();
  });

  it('keeps a declared context window when the endpoint declares none', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        maxContextSize: 1_000_000,
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        maxContextSize: undefined,
      },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.maxContextSize).toBe(1_000_000);
  });

  it('takes the endpoint window when it declares one', () => {
    const merged = mergeRefreshedModelAlias(
      { provider: 'openai', model: 'gpt-5', maxContextSize: 131_072 },
      { provider: 'openai', model: 'gpt-5', maxContextSize: 400_000 },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.maxContextSize).toBe(400_000);
  });

  it('still lets a user override win over a carried or declared window', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'openai',
        model: 'gpt-5',
        maxContextSize: 400_000,
        overrides: { maxContextSize: 200_000 },
      },
      { provider: 'openai', model: 'gpt-5', maxContextSize: undefined },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.maxContextSize).toBe(400_000);
    expect(merged.overrides).toEqual({ maxContextSize: 200_000 });
  });

  it('leaves the window undeclared when neither side has one', () => {
    const merged = mergeRefreshedModelAlias(
      { provider: 'gateway', model: 'router-special' },
      { provider: 'gateway', model: 'router-special', maxContextSize: undefined },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.maxContextSize).toBeUndefined();
  });
});
