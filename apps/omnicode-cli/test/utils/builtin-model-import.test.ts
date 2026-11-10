import { describe, expect, it, vi } from 'vitest';

import {
  backfillCatalogLimits,
  buildFreeTierAliases,
  fetchCatalogLimits,
  type CatalogLimit,
} from '#/utils/builtin-model-import';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CATALOG = {
  openai: {
    id: 'openai',
    models: {
      'gpt-5': {
        id: 'gpt-5',
        name: 'GPT-5',
        limit: { context: 400000, input: 400000, output: 128000 },
        modalities: { input: ['text', 'image'], output: ['text'] },
        tool_call: true,
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
      },
      'text-only': {
        id: 'text-only',
        limit: { context: 8000 },
        modalities: { input: ['text'], output: ['text'] },
      },
    },
  },
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-always': {
        id: 'claude-always',
        limit: { context: 200000, output: 64000 },
        modalities: { input: ['text', 'image'], output: ['text'] },
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
      },
    },
  },
};

function fetchImpl(): typeof fetch {
  return vi.fn(async () => jsonResponse(CATALOG)) as unknown as typeof fetch;
}

describe('fetchCatalogLimits', () => {
  it('reads the limits and the capabilities of a catalog model', async () => {
    const limits = await fetchCatalogLimits('openai', fetchImpl());

    expect(limits.get('gpt-5')).toEqual({
      context: 400000,
      input: 400000,
      output: 128000,
      capabilities: ['image_in', 'always_thinking', 'tool_use'],
    });
  });

  it('declares only the capabilities the catalog states', async () => {
    const limits = await fetchCatalogLimits('openai', fetchImpl());

    expect(limits.get('text-only')?.capabilities).toEqual(['tool_use']);
  });

  it('keeps the thinking switch for a provider that reasons on every request', async () => {
    const limits = await fetchCatalogLimits('anthropic', fetchImpl());

    expect(limits.get('claude-always')?.capabilities).toEqual([
      'image_in',
      'thinking',
      'tool_use',
    ]);
  });

  it('returns nothing when the catalog does not know the provider', async () => {
    const limits = await fetchCatalogLimits('nope', fetchImpl());

    expect(limits.size).toBe(0);
  });
});

describe('backfillCatalogLimits', () => {
  const limits = new Map<string, CatalogLimit>([
    [
      'gpt-5',
      {
        context: 400000,
        input: 400000,
        output: 128000,
        capabilities: ['image_in', 'always_thinking', 'tool_use'],
      },
    ],
  ]);

  it('fills the output limit a compaction request needs', () => {
    const models: Record<string, Record<string, unknown>> = {
      'openai/gpt-5': { provider: 'openai', model: 'gpt-5', maxContextSize: 131072 },
    };

    const touched = backfillCatalogLimits({ models, providerId: 'openai', limits });

    expect(touched).toBe(true);
    expect(models['openai/gpt-5']).toMatchObject({
      maxContextSize: 400000,
      maxInputSize: 400000,
      maxOutputSize: 128000,
    });
  });

  it('merges the catalog capabilities into an alias that only declares tool use', () => {
    const models: Record<string, Record<string, unknown>> = {
      'openai/gpt-5': {
        provider: 'openai',
        model: 'gpt-5',
        maxContextSize: 131072,
        capabilities: ['tool_use'],
      },
    };

    backfillCatalogLimits({ models, providerId: 'openai', limits });

    expect(models['openai/gpt-5']?.['capabilities']).toEqual([
      'tool_use',
      'image_in',
      'always_thinking',
    ]);
  });

  it('keeps a window the user chose and still fills what is missing', () => {
    const models: Record<string, Record<string, unknown>> = {
      'openai/gpt-5': { provider: 'openai', model: 'gpt-5', maxContextSize: 12345 },
    };

    backfillCatalogLimits({ models, providerId: 'openai', limits });

    expect(models['openai/gpt-5']).toMatchObject({
      maxContextSize: 12345,
      maxOutputSize: 128000,
    });
  });

  it('leaves the aliases of another provider alone', () => {
    const models: Record<string, Record<string, unknown>> = {
      'anthropic/claude': { provider: 'anthropic', model: 'claude', maxContextSize: 131072 },
    };

    const touched = backfillCatalogLimits({ models, providerId: 'openai', limits });

    expect(touched).toBe(false);
    expect(models['anthropic/claude']).toEqual({
      provider: 'anthropic',
      model: 'claude',
      maxContextSize: 131072,
    });
  });
});

describe('buildFreeTierAliases', () => {
  it('declares the capabilities the catalog states for the tier', () => {
    const limits = new Map<string, CatalogLimit>([
      [
        'gpt-5',
        { context: 400000, output: 128000, capabilities: ['image_in', 'tool_use'] },
      ],
    ]);

    const aliases = buildFreeTierAliases({
      providerId: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      ids: ['gpt-5'],
      limits,
    });

    expect(aliases['openai/gpt-5']).toMatchObject({
      capabilities: ['image_in', 'tool_use'],
      maxOutputSize: 128000,
    });
  });

  it('falls back to tool use when the catalog knows nothing about the model', () => {
    const aliases = buildFreeTierAliases({
      providerId: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      ids: ['unknown-model'],
      limits: new Map(),
    });

    expect(aliases['openai/unknown-model']?.['capabilities']).toEqual(['tool_use']);
  });
});
