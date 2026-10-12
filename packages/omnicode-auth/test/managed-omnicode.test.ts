import { describe, expect, it, vi } from 'vitest';

import {
  applyManagedApiKeyProviderModels,
  applyManagedOmnicodeCodeLogoutConfig,
  applyManagedOmnicodeCodeConfig,
  clearManagedOmnicodeCodeConfig,
  fetchManagedOmnicodeCodeModels,
  OMNICODE_OAUTH_KEY,
  OMNICODE_PROVIDER_NAME,
  ManagedOmnicodeCodeModelsAuthError,
  provisionManagedOmnicodeCodeConfig,
  resolveOmnicodeCodeLoginAuth,
  resolveOmnicodeCodeOAuthKey,
  resolveOmnicodeCodeOAuthRef,
  resolveOmnicodeCodeRuntimeAuth,
  type ManagedOmnicodeCodeModelInfo,
  type ManagedOmnicodeConfigShape,
} from '../src/managed-omnicode';
import { OAuthUnauthorizedError } from '../src/errors';

function makeModelsResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'omnicode-for-coding',
          context_length: 262144,
          supports_reasoning: true,
          supports_image_in: true,
          supports_video_in: true,
          display_name: 'Omnicode for Coding',
        },
        {
          id: 'omnicode-k2.5',
          context_length: 250000,
          supports_reasoning: false,
          supports_image_in: false,
          supports_video_in: false,
          supports_tool_use: false,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('provisionManagedOmnicodeCodeConfig', () => {
  it('keeps the legacy credential key for the default production environment', () => {
    expect(
      resolveOmnicodeCodeOAuthKey({
        oauthHost: 'https://auth.omnicode.com/',
        baseUrl: 'https://api.omnicode.com/coding/v1/',
      }),
    ).toBe(OMNICODE_OAUTH_KEY);
  });

  it('scopes credential keys for non-default OAuth hosts and API base URLs', () => {
    const devKey = resolveOmnicodeCodeOAuthKey({
      oauthHost: 'https://auth.dev.example.test',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });

    expect(devKey).not.toBe(OMNICODE_OAUTH_KEY);
    expect(devKey).toMatch(/^oauth\/omnicode-env-[a-f0-9]{16}$/);
    expect(
      resolveOmnicodeCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test/',
        baseUrl: 'https://api.dev.example.test/coding/v1/',
      }),
    ).toBe(devKey);
  });

  it('derives a full OAuth ref whose key and persisted host stay in sync', () => {
    // Default environment collapses to the legacy ref (no persisted host), so
    // existing production credentials keep resolving to `omnicode.json`.
    expect(
      resolveOmnicodeCodeOAuthRef({
        oauthHost: 'https://auth.omnicode.com/',
        baseUrl: 'https://api.omnicode.com/coding/v1/',
      }),
    ).toEqual({ storage: 'file', key: OMNICODE_OAUTH_KEY, oauthHost: undefined });

    const defaultAuthCustomApiRef = resolveOmnicodeCodeOAuthRef({
      baseUrl: 'https://api.example.test/coding/v1',
    });
    expect(defaultAuthCustomApiRef).toEqual({
      storage: 'file',
      key: resolveOmnicodeCodeOAuthKey({
        oauthHost: 'https://auth.omnicode.com',
        baseUrl: 'https://api.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.omnicode.com',
    });

    // A non-default environment yields a scoped key AND the normalized host,
    // both derived from the same input — login and runtime cannot drift apart.
    const devRef = resolveOmnicodeCodeOAuthRef({
      oauthHost: 'https://auth.dev.example.test/',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    expect(devRef).toEqual({
      storage: 'file',
      key: resolveOmnicodeCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test',
        baseUrl: 'https://api.dev.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.dev.example.test',
    });
  });

  it('resolves runtime auth from environment overrides over persisted config', () => {
    const configuredBaseUrl = 'https://api.configured.example.test/coding/v1';
    const envBaseUrl = 'https://api.env.example.test/coding/v1/';
    const envOauthHost = 'https://auth.env.example.test/';
    const configuredOAuthRef = resolveOmnicodeCodeOAuthRef({
      baseUrl: configuredBaseUrl,
    });

    const auth = resolveOmnicodeCodeRuntimeAuth({
      configuredBaseUrl,
      configuredOAuthRef,
      env: {
        OMNICODE_BASE_URL: envBaseUrl,
        OMNICODE_OAUTH_HOST: envOauthHost,
      },
    });

    expect(auth.baseUrl).toBe('https://api.env.example.test/coding/v1');
    expect(auth.oauthRef).toEqual({
      storage: 'file',
      key: resolveOmnicodeCodeOAuthKey({
        oauthHost: 'https://auth.env.example.test',
        baseUrl: 'https://api.env.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.env.example.test',
    });
  });

  it('preserves a matching configured runtime OAuth ref when env is not overridden', () => {
    const baseUrl = 'https://api.dev.example.test/coding/v1';
    const configuredOAuthRef = {
      storage: 'keyring' as const,
      key: resolveOmnicodeCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test',
        baseUrl,
      }),
      oauthHost: 'https://auth.dev.example.test',
    };

    expect(
      resolveOmnicodeCodeRuntimeAuth({
        configuredBaseUrl: baseUrl,
        configuredOAuthRef,
        env: {},
      }),
    ).toEqual({
      baseUrl,
      oauthRef: configuredOAuthRef,
    });
  });

  it('resolves login auth without reusing persisted refs under explicit or env overrides', () => {
    const configuredBaseUrl = 'https://api.configured.example.test/coding/v1';
    const configuredOAuthRef = resolveOmnicodeCodeOAuthRef({ baseUrl: configuredBaseUrl });

    expect(
      resolveOmnicodeCodeLoginAuth({
        configuredBaseUrl,
        configuredOAuthRef,
        requestedBaseUrl: 'https://api.requested.example.test/coding/v1/',
        env: {},
      }),
    ).toEqual({
      baseUrl: 'https://api.requested.example.test/coding/v1',
      oauthHost: undefined,
    });

    expect(
      resolveOmnicodeCodeLoginAuth({
        configuredBaseUrl,
        configuredOAuthRef,
        env: {},
      }),
    ).toEqual({
      baseUrl: configuredBaseUrl,
      oauthHost: undefined,
      oauthRef: configuredOAuthRef,
    });
  });

  it('writes the managed provider, models, services, and default model through an adapter', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
          baseUrl: 'https://example.test/v1',
        },
      },
      models: {
        'omnicode/stale': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'stale',
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
        },
      },
    };
    const write = vi.fn();
    const fetchMock = vi.fn(async () => makeModelsResponse());

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
      adapter: {
        configPath: '/tmp/config.toml',
        read: () => config,
        write,
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result).toMatchObject({
      providerName: OMNICODE_PROVIDER_NAME,
      defaultModel: 'omnicode/omnicode-for-coding',
      defaultThinking: true,
      configPath: '/tmp/config.toml',
    });
    expect(result.models[0]?.supportsToolUse).toBe(true);
    expect(result.models[1]?.supportsToolUse).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.omnicode.com/coding/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-access-token',
          Accept: 'application/json',
        }),
      }),
    );
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    const init = calls[0]?.[1] ?? {};
    const headers = new Headers((init.headers ?? {}) as Record<string, string>);
    expect(headers.get('user-agent')).toBeNull();
    expect(headers.get('x-msh-platform')).toBeNull();
    expect(write).toHaveBeenCalledWith(config);

    expect(config.providers['custom']).toMatchObject({
      apiKey: 'sk-existing',
    });
    expect(config.models?.['custom-default']?.provider).toBe('custom');
    expect(config.models?.['omnicode/stale']).toBeUndefined();
    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      type: 'omnicode',
      baseUrl: 'https://api.omnicode.com/coding/v1',
      apiKey: '',
      oauth: { storage: 'file', key: 'oauth/omnicode' },
    });
    expect(config.models?.['omnicode/omnicode-for-coding']).toMatchObject({
      provider: OMNICODE_PROVIDER_NAME,
      model: 'omnicode-for-coding',
      maxContextSize: 262144,
      capabilities: ['thinking', 'image_in', 'video_in', 'tool_use'],
      displayName: 'Omnicode for Coding',
    });
    expect(config.models?.['omnicode/omnicode-k2.5']?.capabilities).toBeUndefined();
    expect(config.services?.hilbrasSearch).toMatchObject({
      baseUrl: 'https://api.omnicode.com/coding/v1/search',
      apiKey: '',
      oauth: { storage: 'file', key: 'oauth/omnicode' },
    });
    expect(Object.keys(config.services ?? {})).toEqual(['hilbrasSearch', 'hilbrasFetch']);
  });

  it('writes scoped OAuth refs when provisioning against a non-default environment', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {},
    };
    const oauthKey = resolveOmnicodeCodeOAuthKey({
      oauthHost: 'https://auth.dev.example.test',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });

    await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      baseUrl: 'https://api.dev.example.test/coding/v1',
      oauthKey,
      oauthHost: 'https://auth.dev.example.test',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      baseUrl: 'https://api.dev.example.test/coding/v1',
      oauth: {
        storage: 'file',
        key: oauthKey,
        oauthHost: 'https://auth.dev.example.test',
      },
    });
    expect(config.services?.hilbrasSearch?.oauth).toEqual({
      storage: 'file',
      key: oauthKey,
      oauthHost: 'https://auth.dev.example.test',
    });
    expect(config.services?.hilbrasFetch?.oauth).toEqual({
      storage: 'file',
      key: oauthKey,
      oauthHost: 'https://auth.dev.example.test',
    });
  });

  it('persists the default OAuth host when only the API base URL is scoped', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {},
    };
    const baseUrl = 'https://api.example.test/coding/v1';
    const oauthKey = resolveOmnicodeCodeOAuthKey({ baseUrl });

    await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      baseUrl,
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      baseUrl,
      oauth: {
        storage: 'file',
        key: oauthKey,
        oauthHost: 'https://auth.omnicode.com',
      },
    });
  });

  it('preserves an existing valid default model during refresh', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
          baseUrl: 'https://example.test/v1',
        },
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
        },
      },
      defaultModel: 'custom-default',
      thinking: { enabled: false },
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
        'omnicode/stale': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'stale',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultModel).toBe('custom-default');
    expect(config.thinking?.enabled).toBe(false);
    expect(config.models?.['omnicode/stale']).toBeUndefined();
    expect(config.models?.['omnicode/omnicode-for-coding']?.displayName).toBe('Omnicode for Coding');
  });

  it('infers default_thinking from fresh managed model capabilities', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
        },
      },
      defaultModel: 'omnicode/omnicode-for-coding',
      models: {
        'omnicode/omnicode-for-coding': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'omnicode-for-coding',
          maxContextSize: 1000,
          capabilities: [],
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('omnicode/omnicode-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('preserves explicit default_thinking when preserving a custom default without capabilities', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      thinking: { enabled: true },
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('defaults default_thinking to false when a preserved custom default has no signal', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('does not infer default_thinking from preserved custom default capabilities', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
          capabilities: [],
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('keeps default_thinking off even when preserved custom default has thinking capability', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('falls back to the first fetched model when the preserved default was removed', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
        },
      },
      defaultModel: 'omnicode/stale',
      thinking: { enabled: false },
      models: {
        'omnicode/stale': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'stale',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('omnicode/omnicode-for-coding');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultModel).toBe('omnicode/omnicode-for-coding');
    expect(config.thinking?.enabled).toBe(false);
  });

  it('removes managed provider, models, services, and default model on logout', () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
        },
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'omnicode/omnicode-for-coding',
      thinking: { enabled: true },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'omnicode-for-coding',
          maxContextSize: 262144,
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
      services: {
        hilbrasSearch: { baseUrl: 'https://api.omnicode.com/coding/v1/search' },
        hilbrasFetch: { baseUrl: 'https://api.omnicode.com/coding/v1/fetch' },
        customService: { baseUrl: 'https://service.example.test' },
      },
      raw: {
        default_model: 'omnicode/omnicode-for-coding',
        providers: {
          [OMNICODE_PROVIDER_NAME]: { type: 'omnicode' },
          custom: { type: 'omnicode' },
        },
        models: {
          'omnicode/omnicode-for-coding': {
            provider: OMNICODE_PROVIDER_NAME,
            model: 'omnicode-for-coding',
          },
          'custom-default': {
            provider: 'custom',
            model: 'custom-model',
          },
        },
        services: {
          hilbras_search: { base_url: 'https://api.omnicode.com/coding/v1/search' },
          hilbras_fetch: { base_url: 'https://api.omnicode.com/coding/v1/fetch' },
        },
      },
    };

    applyManagedOmnicodeCodeLogoutConfig(config);

    expect(config.defaultModel).toBeUndefined();
    expect(config.providers[OMNICODE_PROVIDER_NAME]).toBeUndefined();
    expect(config.providers['custom']).toBeDefined();
    expect(config.models?.['omnicode/omnicode-for-coding']).toBeUndefined();
    expect(config.models?.['custom-default']).toBeDefined();
    expect(config.services?.hilbrasSearch).toBeUndefined();
    expect(config.services?.hilbrasFetch).toBeUndefined();
    expect(config.services?.['customService']).toEqual({
      baseUrl: 'https://service.example.test',
    });
  });

  it('rejects managed models that do not include a positive context_length', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'omnicode-for-coding', supports_reasoning: true }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedOmnicodeCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toThrow(/positive context_length/);
  });

  it('surfaces API error messages from model listing failures', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedOmnicodeCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toThrow('quota exceeded');
  });

  it('classifies model listing 401 responses as OAuth unauthorized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'The API Key appears to be invalid or may have expired.' },
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedOmnicodeCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthUnauthorizedError);
  });

  it('classifies membership-check 402 responses as OAuth unauthorized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "We're unable to verify your membership benefits at this time. Please ensure your membership is active.",
            },
          }),
          {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ) as unknown as typeof fetch;

    const promise = fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      baseUrl: 'https://api.dev.example.test/coding/v1',
      fetchImpl,
    });

    await expect(promise).rejects.toThrow(
      "Omnicode models endpoint https://api.dev.example.test/coding/v1 rejected OAuth credentials: We're unable to verify your membership benefits at this time. Please ensure your membership is active.",
    );
    await expect(
      fetchManagedOmnicodeCodeModels({
        accessToken: 'oauth-access-token',
        baseUrl: 'https://api.dev.example.test/coding/v1',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 402,
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    await expect(
      fetchManagedOmnicodeCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthUnauthorizedError);
    await expect(
      fetchManagedOmnicodeCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ManagedOmnicodeCodeModelsAuthError);
  });

  it('clears managed provider, models, default model, and services on logout', () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/omnicode' },
        },
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'omnicode/omnicode-for-coding',
      models: {
        'omnicode/omnicode-for-coding': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'omnicode-for-coding',
          maxContextSize: 262144,
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 128000,
        },
      },
      services: {
        hilbrasSearch: {
          baseUrl: 'https://api.omnicode.com/coding/v1/search',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/omnicode' },
        },
        hilbrasFetch: {
          baseUrl: 'https://api.omnicode.com/coding/v1/fetch',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/omnicode' },
        },
        otherService: { baseUrl: 'https://service.example.test' },
      },
    };

    const result = clearManagedOmnicodeCodeConfig(config);

    expect(result).toMatchObject({
      providerName: OMNICODE_PROVIDER_NAME,
      removedProvider: true,
      removedModels: ['omnicode/omnicode-for-coding'],
      defaultModelCleared: true,
      removedServices: ['hilbrasSearch', 'hilbrasFetch'],
    });
    expect(config.providers[OMNICODE_PROVIDER_NAME]).toBeUndefined();
    expect(config.providers['custom']).toMatchObject({ apiKey: 'sk-existing' });
    expect(config.defaultModel).toBeUndefined();
    expect(config.models?.['omnicode/omnicode-for-coding']).toBeUndefined();
    expect(config.models?.['custom-default']).toMatchObject({ provider: 'custom' });
    expect(config.services?.hilbrasSearch).toBeUndefined();
    expect(config.services?.hilbrasFetch).toBeUndefined();
    expect(config.services?.['otherService']).toMatchObject({
      baseUrl: 'https://service.example.test',
    });
  });
});

describe('supports_thinking_type', () => {
  function makeThinkingTypeModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'omnicode-for-coding',
            context_length: 262144,
            supports_reasoning: true,
            supports_image_in: true,
            supports_video_in: true,
            supports_thinking_type: 'only',
            supports_dynamic_tools: true,
            display_name: 'Omnicode For Coding',
          },
          {
            // 'no' is the authoritative declaration and overrides the legacy
            // supports_reasoning boolean.
            id: 'omnicode-plain',
            context_length: 128000,
            supports_reasoning: true,
            supports_thinking_type: 'no',
          },
          {
            id: 'omnicode-toggle',
            context_length: 128000,
            supports_reasoning: true,
            supports_thinking_type: 'both',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('parses supports_thinking_type and supports_dynamic_tools from the models endpoint', async () => {
    const models = await fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
    });

    expect(models[0]?.supportsThinkingType).toBe('only');
    expect(models[1]?.supportsThinkingType).toBe('no');
    expect(models[2]?.supportsThinkingType).toBe('both');
    expect(models[0]?.supportsDynamicTools).toBe(true);
    expect(models[1]?.supportsDynamicTools).toBe(false);
  });

  it('leaves supportsThinkingType undefined when the field is absent or invalid', async () => {
    const absent = await fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
    });
    expect(absent[0]?.supportsThinkingType).toBeUndefined();

    const invalid = await fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'omnicode-for-coding',
                  context_length: 262144,
                  supports_reasoning: true,
                  supports_thinking_type: 'maybe',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch,
    });
    expect(invalid[0]?.supportsThinkingType).toBeUndefined();
  });

  it('maps the three states onto capabilities, overriding supports_reasoning', async () => {
    const config: ManagedOmnicodeConfigShape = { providers: {} };

    await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    // 'only' → thinking locked on; supports_dynamic_tools adds dynamically_loaded_tools.
    expect(config.models?.['omnicode/omnicode-for-coding']?.capabilities).toEqual([
      'thinking',
      'always_thinking',
      'image_in',
      'video_in',
      'tool_use',
      'dynamically_loaded_tools',
    ]);
    // 'no' → no thinking capability despite supports_reasoning=true.
    expect(config.models?.['omnicode/omnicode-plain']?.capabilities).toEqual(['tool_use']);
    // 'both' → plain toggleable thinking.
    expect(config.models?.['omnicode/omnicode-toggle']?.capabilities).toEqual([
      'thinking',
      'tool_use',
    ]);
  });

  it('forces default thinking on when the selected default model is thinking-only', async () => {
    const config: ManagedOmnicodeConfigShape = { providers: {}, thinking: { enabled: false } };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('omnicode/omnicode-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('forces default thinking on when preserving a thinking-only managed default', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
        },
      },
      defaultModel: 'omnicode/omnicode-for-coding',
      thinking: { enabled: false },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'omnicode-for-coding',
          maxContextSize: 262144,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('omnicode/omnicode-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.thinking?.enabled).toBe(true);
  });

  it('forces default thinking off when preserving a no-thinking managed default', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        [OMNICODE_PROVIDER_NAME]: {
          type: 'omnicode',
          apiKey: '',
        },
      },
      defaultModel: 'omnicode/omnicode-plain',
      thinking: { enabled: true },
      models: {
        'omnicode/omnicode-plain': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'omnicode-plain',
          maxContextSize: 128000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('omnicode/omnicode-plain');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });

  it('keeps a preserved non-managed default thinking selection untouched', async () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        custom: {
          type: 'omnicode',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      thinking: { enabled: false },
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.thinking?.enabled).toBe(false);
  });
});

describe('support_efforts / default_effort', () => {
  function makeEffortModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'omnicode-for-coding',
            context_length: 262144,
            supports_reasoning: true,
            supports_thinking_type: 'both',
            think_efforts: {
              support: true,
              valid_efforts: ['low', 'high', 'max'],
              default_effort: 'high',
            },
            display_name: 'Omnicode For Coding',
          },
          {
            // Empty / non-string entries are filtered; absent fields stay undefined.
            id: 'omnicode-plain',
            context_length: 128000,
            supports_reasoning: true,
            think_efforts: { support: true, valid_efforts: ['low', '', 42] },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('parses think_efforts from the models endpoint', async () => {
    const models = await fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeEffortModelsResponse()) as unknown as typeof fetch,
    });

    expect(models[0]?.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(models[0]?.defaultEffort).toBe('high');
    // The empty string and number are filtered out of valid_efforts.
    expect(models[1]?.supportEfforts).toEqual(['low']);
    expect(models[1]?.defaultEffort).toBeUndefined();
  });

  it('ignores think_efforts entirely when support is not true', async () => {
    const models = await fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'omnicode-no-effort',
                context_length: 128000,
                supports_reasoning: true,
                think_efforts: {
                  support: false,
                  valid_efforts: ['low', 'high'],
                  default_effort: 'high',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    // support !== true gates the whole object — valid_efforts / default_effort
    // are ignored.
    expect(models[0]?.supportEfforts).toBeUndefined();
    expect(models[0]?.defaultEffort).toBeUndefined();
  });

  it('ignores legacy flat fields even when think_efforts is absent', async () => {
    // The legacy support_efforts / default_effort fields are no longer read;
    // only the nested think_efforts object is honored.
    const models = await fetchManagedOmnicodeCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'omnicode-k2',
                context_length: 128000,
                supports_reasoning: true,
                support_efforts: ['low', 'high'],
                default_effort: 'high',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    expect(models[0]?.supportEfforts).toBeUndefined();
    expect(models[0]?.defaultEffort).toBeUndefined();
  });

  it('writes supportEfforts and defaultEffort onto the provisioned model entry', async () => {
    const config: ManagedOmnicodeConfigShape = { providers: {} };

    await provisionManagedOmnicodeCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeEffortModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedOmnicodeCodeConfig,
      },
    });

    const alias = config.models?.['omnicode/omnicode-for-coding'];
    expect(alias?.['supportEfforts']).toEqual(['low', 'high', 'max']);
    expect(alias?.['defaultEffort']).toBe('high');
  });
});

describe('selective merge', () => {
  const baseOptions = {
    baseUrl: 'https://api.example.test/coding/v1',
    oauthKey: 'test-key',
  };

  it('preserves non-managed user fields but drops stale managed fields', () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {},
      models: {
        'omnicode/omnicode-k2': {
          provider: 'omnicode',
          model: 'omnicode-k2',
          maxContextSize: 262144,
          capabilities: ['thinking'],
          maxOutputSize: 4096,
          supportEfforts: ['low', 'high', 'max'],
        } as Record<string, unknown>,
      },
    };

    applyManagedOmnicodeCodeConfig(config, {
      ...baseOptions,
      models: [
        {
          id: 'omnicode-k2',
          contextLength: 262144,
          supportsReasoning: true,
          supportsImageIn: false,
          supportsVideoIn: false,
          supportsThinkingType: 'both',
        },
      ],
    });

    const alias = config.models?.['omnicode/omnicode-k2'];
    expect(alias?.['maxOutputSize']).toBe(4096);
    expect(alias?.['supportEfforts']).toBeUndefined();
    expect(alias?.['maxContextSize']).toBe(262144);
  });

  it('preserves overrides when upstream declares managed fields', () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {},
      models: {
        'omnicode/omnicode-k2': {
          provider: 'omnicode',
          model: 'omnicode-k2',
          maxContextSize: 262144,
          overrides: { supportEfforts: ['low'] },
        } as Record<string, unknown>,
      },
    };

    applyManagedOmnicodeCodeConfig(config, {
      ...baseOptions,
      models: [
        {
          id: 'omnicode-k2',
          contextLength: 262144,
          supportsReasoning: true,
          supportsImageIn: false,
          supportsVideoIn: false,
          supportEfforts: ['low', 'high', 'max'],
          defaultEffort: 'high',
        },
      ],
    });

    const alias = config.models?.['omnicode/omnicode-k2'];
    expect(alias?.['supportEfforts']).toEqual(['low', 'high', 'max']);
    expect(alias?.['defaultEffort']).toBe('high');
    expect(alias?.['overrides']).toEqual({ supportEfforts: ['low'] });
  });

  it('removes managed models that upstream no longer lists', () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {},
      models: {
        'omnicode/omnicode-k2': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'omnicode-k2',
          maxContextSize: 262144,
        },
        'omnicode/removed': {
          provider: OMNICODE_PROVIDER_NAME,
          model: 'removed',
          maxContextSize: 128000,
        },
      },
    };

    applyManagedOmnicodeCodeConfig(config, {
      ...baseOptions,
      models: [
        {
          id: 'omnicode-k2',
          contextLength: 262144,
          supportsReasoning: true,
          supportsImageIn: false,
          supportsVideoIn: false,
        },
      ],
    });

    expect(config.models?.['omnicode/omnicode-k2']).toBeDefined();
    expect(config.models?.['omnicode/removed']).toBeUndefined();
  });
});

describe('applyManagedApiKeyProviderModels', () => {
  it('merges upstream models without touching provider, services, or defaults', () => {
    const config: ManagedOmnicodeConfigShape = {
      providers: {
        'my-omnicode': {
          type: 'omnicode',
          baseUrl: 'https://api.example.test/coding/v1',
          apiKey: 'sk-distributed-key',
        },
      },
      models: {
        'my-omnicode/omnicode-k2': {
          provider: 'my-omnicode',
          model: 'omnicode-k2',
          maxContextSize: 262144,
          displayName: 'Old K2',
          maxOutputSize: 4096,
        } as Record<string, unknown>,
        'my-omnicode/omnicode-old': {
          provider: 'my-omnicode',
          model: 'omnicode-old',
          maxContextSize: 128000,
        },
        'other/m1': {
          provider: 'other',
          model: 'm1',
          maxContextSize: 128000,
        },
      },
      defaultModel: 'my-omnicode/omnicode-k2',
      thinking: { enabled: false },
    };

    applyManagedApiKeyProviderModels(
      config,
      'my-omnicode',
      [makeModelInfo('omnicode-k2', { displayName: 'Fresh K2' }), makeModelInfo('omnicode-k2.5')],
      'my-omnicode/',
    );

    // The provider record is user-owned: no rewrite, no oauth, no apiKey reset.
    expect(config.providers['my-omnicode']).toEqual({
      type: 'omnicode',
      baseUrl: 'https://api.example.test/coding/v1',
      apiKey: 'sk-distributed-key',
    });
    // Defaults and services are the orchestrator's / OAuth branch's business.
    expect(config.defaultModel).toBe('my-omnicode/omnicode-k2');
    expect(config.thinking).toEqual({ enabled: false });
    expect(config.services).toBeUndefined();
    // Upstream-owned fields merge; hand-written extras survive.
    const alias = config.models?.['my-omnicode/omnicode-k2'];
    expect(alias?.['displayName']).toBe('Fresh K2');
    expect(alias?.['maxOutputSize']).toBe(4096);
    // New upstream model added; dropped one removed; other providers untouched.
    expect(config.models?.['my-omnicode/omnicode-k2.5']).toBeDefined();
    expect(config.models?.['my-omnicode/omnicode-old']).toBeUndefined();
    expect(config.models?.['other/m1']).toBeDefined();
  });

  it('writes protocol routing fields for anthropic-protocol models', () => {
    const config: ManagedOmnicodeConfigShape = { providers: {}, models: {} };

    applyManagedApiKeyProviderModels(
      config,
      'my-omnicode',
      [makeModelInfo('omnicode-for-coding', { protocol: 'anthropic', supportsReasoning: true })],
      'my-omnicode/',
    );

    const alias = config.models?.['my-omnicode/omnicode-for-coding'];
    expect(alias?.['provider']).toBe('my-omnicode');
    expect(alias?.['protocol']).toBe('anthropic');
    expect(alias?.['betaApi']).toBe(true);
    expect(alias?.['adaptiveThinking']).toBe(true);
    expect(alias?.['capabilities']).toEqual(['thinking', 'tool_use']);
  });

  it('rejects models without a positive context length', () => {
    const config: ManagedOmnicodeConfigShape = { providers: {}, models: {} };

    expect(() => {
      applyManagedApiKeyProviderModels(
        config,
        'my-omnicode',
        [makeModelInfo('bad', { contextLength: 0 })],
        'my-omnicode/',
      );
    }).toThrow('context_length');
  });
});

function makeModelInfo(
  id: string,
  overrides: Partial<ManagedOmnicodeCodeModelInfo> = {},
): ManagedOmnicodeCodeModelInfo {
  return {
    id,
    contextLength: 200000,
    supportsReasoning: false,
    supportsImageIn: false,
    supportsVideoIn: false,
    ...overrides,
  };
}

const OMNICODE_BASE_URL = 'https://api.omnicode.com/coding/v1';

describe('managed protocol routing', () => {
  it('reads protocol from the /models response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'omnicode-for-coding', context_length: 262144, protocol: 'anthropic' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const models = await fetchManagedOmnicodeCodeModels({ accessToken: 't', fetchImpl });
    expect(models).toHaveLength(1);
    expect(models[0]?.protocol).toBe('anthropic');
  });

  it('maps the server "response" protocol value to openai_responses', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'k3', context_length: 1048576, protocol: 'response' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const models = await fetchManagedOmnicodeCodeModels({ accessToken: 't', fetchImpl });
    expect(models).toHaveLength(1);
    expect(models[0]?.protocol).toBe('openai_responses');
  });

  it('records openai_responses protocol without anthropic routing fields', () => {
    const config: ManagedOmnicodeConfigShape = { providers: {} };
    applyManagedOmnicodeCodeConfig(config, {
      baseUrl: OMNICODE_BASE_URL,
      models: [makeModelInfo('k3', { protocol: 'openai_responses', supportsReasoning: true })],
    });

    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      type: 'omnicode',
      baseUrl: OMNICODE_BASE_URL,
      apiKey: '',
    });
    const alias = config.models?.['omnicode/k3'];
    expect(alias?.protocol).toBe('openai_responses');
    expect(alias?.betaApi).toBeUndefined();
    expect(alias?.adaptiveThinking).toBeUndefined();
  });

  it('keeps the provider on the omnicode REST base and records the model protocol when anthropic', () => {
    const config: ManagedOmnicodeConfigShape = { providers: {} };
    applyManagedOmnicodeCodeConfig(config, {
      baseUrl: OMNICODE_BASE_URL,
      models: [makeModelInfo('omnicode-for-coding', { protocol: 'anthropic' })],
    });

    // The provider stays on the omnicode wire + REST base; the anthropic transport
    // is resolved per-model at runtime, not baked into the provider config, so
    // the REST base keeps flowing to OAuth key derivation and plugin env.
    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      type: 'omnicode',
      baseUrl: OMNICODE_BASE_URL,
      apiKey: '',
    });
    expect(config.models?.['omnicode/omnicode-for-coding']).toMatchObject({
      provider: OMNICODE_PROVIDER_NAME,
      protocol: 'anthropic',
      betaApi: true,
    });
  });

  it('keeps the omnicode protocol and baseUrl when the model has no anthropic protocol', () => {
    const config: ManagedOmnicodeConfigShape = { providers: {} };
    applyManagedOmnicodeCodeConfig(config, {
      baseUrl: OMNICODE_BASE_URL,
      models: [makeModelInfo('omnicode-for-coding')],
    });

    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      type: 'omnicode',
      baseUrl: OMNICODE_BASE_URL,
      apiKey: '',
    });
    expect(config.models?.['omnicode/omnicode-for-coding']?.provider).toBe(OMNICODE_PROVIDER_NAME);
    expect(config.models?.['omnicode/omnicode-for-coding']?.protocol).toBeUndefined();
  });

  it('drops the model protocol on refresh when the server stops declaring anthropic', () => {
    const config: ManagedOmnicodeConfigShape = { providers: {} };
    applyManagedOmnicodeCodeConfig(config, {
      baseUrl: OMNICODE_BASE_URL,
      models: [makeModelInfo('omnicode-for-coding', { protocol: 'anthropic' })],
    });
    expect(config.models?.['omnicode/omnicode-for-coding']?.protocol).toBe('anthropic');

    applyManagedOmnicodeCodeConfig(config, {
      baseUrl: OMNICODE_BASE_URL,
      models: [makeModelInfo('omnicode-for-coding')],
    });
    // The provider never leaves the omnicode wire / REST base across refreshes —
    // only the per-model protocol annotation changes.
    expect(config.providers[OMNICODE_PROVIDER_NAME]).toMatchObject({
      type: 'omnicode',
      baseUrl: OMNICODE_BASE_URL,
    });
    expect(config.models?.['omnicode/omnicode-for-coding']?.protocol).toBeUndefined();
  });
});
