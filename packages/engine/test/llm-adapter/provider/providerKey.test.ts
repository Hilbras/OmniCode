import { describe, expect, it } from 'vitest';

import {
  assertProviderApiKey,
  checkProviderApiKey,
  providerKeyFamily,
} from '#/llm-adapter/provider/provider-key';

describe('checkProviderApiKey', () => {
  it('rejects keys that are not safe in a header', () => {
    expect(checkProviderApiKey('anthropic', '')).toMatchObject({ ok: false });
    expect(checkProviderApiKey('anthropic', '   ')).toMatchObject({ ok: false });
    expect(checkProviderApiKey('anthropic', ' sk-ant-abc')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('whitespace'),
    });
    expect(checkProviderApiKey('anthropic', 'sk-ant-abc\n')).toMatchObject({ ok: false });
    expect(checkProviderApiKey('anthropic', 'sk-ant-a b c')).toMatchObject({ ok: false });
    expect(checkProviderApiKey('anthropic', 'sk-ant-\u0000abc')).toMatchObject({ ok: false });
  });

  it('accepts a first-party key for its own provider', () => {
    expect(checkProviderApiKey('anthropic', 'sk-ant-api03-abc')).toEqual({ ok: true });
    expect(checkProviderApiKey('google-genai', 'AIzaSyExampleKey')).toEqual({ ok: true });
  });

  it('rejects a key whose signature belongs to another first-party provider', () => {
    expect(checkProviderApiKey('openai', 'sk-ant-api03-abc')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Anthropic'),
    });
    expect(checkProviderApiKey('openai_responses', 'sk-ant-api03-abc')).toMatchObject({
      ok: false,
    });
    expect(checkProviderApiKey('anthropic', 'AIzaSyExampleKey')).toMatchObject({ ok: false });
  });

  it('does not treat a generic sk- key as an OpenAI signature', () => {
    expect(providerKeyFamily('sk-proj-abc')).toBeUndefined();
    expect(checkProviderApiKey('anthropic', 'sk-proj-abc')).toEqual({ ok: true });
    expect(checkProviderApiKey(undefined, 'anything')).toEqual({ ok: true });
    expect(checkProviderApiKey('custom-gateway', 'sk-ant-abc')).toEqual({ ok: true });
  });

  it('leaves the managed provider to its own endpoint', () => {
    expect(checkProviderApiKey('omnicode', 'sk-ant-abc')).toEqual({ ok: true });
  });
});

describe('assertProviderApiKey', () => {
  it('names the field without echoing the key', () => {
    expect(() =>
      assertProviderApiKey('openai', 'sk-ant-secret-material', 'providers.openai.api_key'),
    ).toThrowError(/providers\.openai\.api_key /);
    try {
      assertProviderApiKey('openai', 'sk-ant-secret-material', 'providers.openai.api_key');
    } catch (error) {
      const configError = error as { code?: string; message: string };
      expect(configError.code).toBe('config.invalid');
      expect(configError.message).not.toContain('secret-material');
    }
  });

  it('returns a valid key unchanged', () => {
    expect(assertProviderApiKey('anthropic', 'sk-ant-key', 'field')).toBe('sk-ant-key');
  });
});