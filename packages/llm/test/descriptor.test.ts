import { describe, expect, it } from 'vitest';

import {
  ProviderDescriptorRegistry,
  patternMatcher,
  prefixMatcher,
  validateKeyPrefix,
  validateNonEmptyKey,
} from '#/descriptor';

const anthropic = {
  id: 'anthropic',
  name: 'Anthropic',
  ownsModel: prefixMatcher('claude-'),
  validateKey: validateKeyPrefix('sk-ant-'),
};
const openai = {
  id: 'openai',
  name: 'OpenAI',
  ownsModel: patternMatcher(/^gpt-/, /^o[134]-/),
  validateKey: validateNonEmptyKey,
};

describe('provider descriptors', () => {
  it('resolves one provider per model', () => {
    const registry = new ProviderDescriptorRegistry();
    registry.register(anthropic);
    registry.register(openai);
    expect(registry.resolve('claude-sonnet-4')?.id).toBe('anthropic');
    expect(registry.resolve('gpt-5')?.id).toBe('openai');
    expect(registry.resolve('o3-mini')?.id).toBe('openai');
    expect(registry.resolve('mystery-model')).toBeUndefined();
  });

  it('rejects overlapping ownership', () => {
    const registry = new ProviderDescriptorRegistry();
    registry.register(openai);
    registry.register({ id: 'gateway', name: 'Gateway', ownsModel: prefixMatcher('gpt-') });
    expect(() => registry.resolve('gpt-5')).toThrow('claimed by multiple providers');
  });

  it('validates keys without guessing', () => {
    expect(anthropic.validateKey('sk-ant-123')).toEqual({ ok: true });
    expect(anthropic.validateKey('sk-openai')).toMatchObject({ ok: false });
    expect(openai.validateKey('   ')).toMatchObject({ ok: false });
  });

  it('rejects duplicate provider ids', () => {
    const registry = new ProviderDescriptorRegistry();
    registry.register(openai);
    expect(() => registry.register(openai)).toThrow('already registered');
  });
});
