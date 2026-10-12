import { emptyUsage } from '#human/llm/usage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentProfileService } from '#/agent/profile/profile';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import type { ModelRecord } from '#/llm-adapter/model/model';
import {
  configServices,
  createTestAgent,
  InMemoryWireRecordPersistence,
  llmGenerateServices,
  modelProviderOptionServices,
  requesterFromGenerateFn,
  telemetryServices,
  wireRecordPersistenceServices,
  type LegacyGenerateFn,
  type TestAgentContext,
} from '../../harness';
import { recordingTelemetry, type TelemetryRecord } from '../../app/telemetry/stubs';

type TestOmnicodeConfig = ReturnType<Parameters<typeof configServices>[0]>;
type TestProtocolModelConfig = NonNullable<TestOmnicodeConfig['models']>[string] &
  Pick<ModelRecord, 'protocol'>;
type GenerateFn = Parameters<typeof llmGenerateServices>[0];

function defaultGenerate(): GenerateFn {
  return {
    generate: () => Promise.reject(new Error('generate should not be called')),
  };
}

describe('ConfigState model capabilities', () => {
  let ctx: TestAgentContext;
  let profile: IAgentProfileService;
  let requester: IAgentLLMRequesterService;
  let omnicodeConfig: TestOmnicodeConfig;
  let generate: GenerateFn;
  let records: TelemetryRecord[];

  beforeEach(() => {
    omnicodeConfig = {
      providers: {},
    };
    generate = defaultGenerate();
    records = [];
    ctx = createTestAgent(
      configServices(() => omnicodeConfig),
      llmGenerateServices({
        generate: (config, content, control) => generate.generate(config, content, control),
      }),
      telemetryServices(recordingTelemetry(records)),
    );
    profile = ctx.get(IAgentProfileService);
    requester = ctx.get(IAgentLLMRequesterService);
  });

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  it('computes provider and model capabilities from config metadata', () => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: 'omnicode',
          model: 'omnicode-for-coding',
          maxContextSize: 1_000_000,
          supportEfforts: ['low', 'high'],
          capabilities: ['image_in', 'video_in', 'thinking', 'tool_use'],
        },
      },
    };

    profile.update({ modelAlias: 'omnicode/omnicode-for-coding' });

    expect(profile.getModel()).toBe('omnicode/omnicode-for-coding');
    expect(ctx.modelResolver.get('omnicode/omnicode-for-coding').name).toBe('omnicode-for-coding');
    expect(profile.getModelCapabilities()).toMatchObject({
      image_in: true,
      video_in: true,
      audio_in: false,
      thinking: true,
      tool_use: true,
      max_context_tokens: 1_000_000,
    });
  });

  it('republishes the model status slice on demand', () => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: 'omnicode',
          model: 'omnicode-for-coding',
          maxContextSize: 1_000_000,
          supportEfforts: ['low', 'high'],
        },
      },
    };
    profile.update({ modelAlias: 'omnicode/omnicode-for-coding' });
    const before = ctx.allEvents.filter((entry) => entry.event === 'agent.status.updated').length;

    profile.republishStatus();

    const statuses = ctx.allEvents.filter((entry) => entry.event === 'agent.status.updated');
    expect(statuses).toHaveLength(before + 1);
    expect(statuses.at(-1)?.args).toMatchObject({
      model: 'omnicode/omnicode-for-coding',
      maxContextTokens: 1_000_000,
    });
  });

  it('omits maxContextTokens when the bound model no longer resolves', () => {
    profile.update({ modelAlias: 'ghost/model' });

    const statuses = ctx.allEvents.filter((entry) => entry.event === 'agent.status.updated');
    expect(statuses.length).toBeGreaterThan(0);
    const last = statuses.at(-1)?.args as { model?: string; maxContextTokens?: number };
    expect(last.model).toBe('ghost/model');
    expect(last.maxContextTokens).toBeUndefined();
  });

  it('tracks thinking_toggle with the effort payload when effort changes', () => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: 'omnicode',
          model: 'omnicode-for-coding',
          maxContextSize: 1_000_000,
          capabilities: ['thinking'],
          supportEfforts: ['low', 'high'],
        },
      },
    };
    profile.update({ modelAlias: 'omnicode/omnicode-for-coding' });
    profile.setThinking('off');
    records.length = 0;

    profile.setThinking('low');

    expect(records).toContainEqual({
      event: 'thinking_toggle',
      properties: {
        agent_id: 'main',
        enabled: true,
        effort: 'low',
        from: 'off',
        mode: 'agent',
        model: 'omnicode/omnicode-for-coding',
        protocol: 'openai',
        provider_type: 'omnicode',
      },
    });
  });

  it('writes the bound model into the ambient telemetry context', () => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: 'omnicode',
          model: 'omnicode-for-coding',
          maxContextSize: 1_000_000,
        },
      },
    };

    profile.update({ modelAlias: 'omnicode/omnicode-for-coding' });

    expect(ctx.get(ITelemetryService).getContext()).toMatchObject({
      model: 'omnicode/omnicode-for-coding',
      provider_type: 'omnicode',
      protocol: 'openai',
    });
  });

  it('keeps the alias as ambient model when the bound model does not resolve', () => {
    profile.update({ modelAlias: 'ghost/model' });

    expect(ctx.get(ITelemetryService).getContext()).toMatchObject({
      model: 'ghost/model',
    });
  });

  it('restores the ambient model after a cold resume', async () => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode/omnicode-for-coding': {
          provider: 'omnicode',
          model: 'omnicode-for-coding',
          maxContextSize: 1_000_000,
        },
      },
    };
    const resumedRecords: TelemetryRecord[] = [];
    const resumed = createTestAgent(
      { autoConfigure: false },
      configServices(() => omnicodeConfig),
      llmGenerateServices({
        generate: (config, content, control) => generate.generate(config, content, control),
      }),
      telemetryServices(recordingTelemetry(resumedRecords)),
      wireRecordPersistenceServices(
        new InMemoryWireRecordPersistence([
          { type: 'config.update', agentId: 'main', modelAlias: 'omnicode/omnicode-for-coding' },
        ]),
      ),
    );
    try {
      await resumed.restorePersisted();

      expect(resumed.get(ITelemetryService).getContext()).toMatchObject({
        model: 'omnicode/omnicode-for-coding',
        provider_type: 'omnicode',
        protocol: 'openai',
      });
    } finally {
      await resumed.dispose();
    }
  });

  it('does not infer Omnicode capabilities from the provider catalogue', () => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode': {
          provider: 'omnicode',
          model: 'omnicode',
          maxContextSize: 128_000,
        },
      },
    };

    profile.update({ modelAlias: 'omnicode' });

    expect(profile.getModelCapabilities()).toMatchObject({
      image_in: false,
      video_in: false,
      audio_in: false,
      max_context_tokens: 128_000,
    });
  });

  it('uses model max output size as the LLM completion cap', async () => {
    let requestMaxTokens: unknown;
    omnicodeConfig = {
      providers: {
        deepseek: {
          type: 'openai',
          apiKey: 'test-key',
          baseUrl: 'https://api.deepseek.example/v1',
        },
      },
      models: {
        'deepseek/deepseek-v4-flash': {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          maxContextSize: 1_000_000,
          maxOutputSize: 384_000,
        },
      },
    };
    generate = requesterFromGenerateFn(async (_provider, _systemPrompt, _tools, _history, _callbacks, options) => {
      requestMaxTokens = options?.maxCompletionTokens;
      return {
        id: 'response-1',
        message: { role: 'assistant', content: [], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    });

    profile.update({
      modelAlias: 'deepseek/deepseek-v4-flash',
      systemPrompt: 'system',
      thinkingLevel: 'off',
    });
    await requester.request({}, undefined, new AbortController().signal);

    expect(requestMaxTokens).toBe(384000);
  });
});

describe('ConfigState prompt cache hint', () => {
  let ctx: TestAgentContext;
  let profile: IAgentProfileService;
  let omnicodeConfig: TestOmnicodeConfig;

  beforeEach(() => {
    omnicodeConfig = {
      providers: {
        omnicode: {
          type: 'omnicode',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.test/v1',
        },
      },
      models: {
        'omnicode': {
          provider: 'omnicode',
          model: 'omnicode',
          maxContextSize: 128_000,
        },
      },
    };
    ctx = createTestAgent(
      configServices(() => omnicodeConfig),
      modelProviderOptionServices({ promptCacheKey: 'session-test' }),
    );
    profile = ctx.get(IAgentProfileService);
  });

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  it('uses session id as a provider prompt cache hint without storing it on Agent', () => {
    profile.update({ modelAlias: 'omnicode' });

    const model = ctx.modelResolver.get('omnicode');
    expect(model.protocol).toBe('openai');
    expect(model.providerType).toBe('omnicode');
    expect('sessionId' in ctx).toBe(false);
  });
});

describe('ConfigState thinking clamp for always-thinking models', () => {
  let ctx: TestAgentContext;
  let profile: IAgentProfileService;
  let requester: IAgentLLMRequesterService;
  let omnicodeConfig: TestOmnicodeConfig;
  let capturedThinking: unknown;

  beforeEach(() => {
    omnicodeConfig = {
      providers: { omnicode: { type: 'omnicode', apiKey: 'test-key', baseUrl: 'https://api.example.test/v1' } },
      models: {
        'omnicode/deep': {
          provider: 'omnicode',
          model: 'omnicode-deep-coder',
          maxContextSize: 128_000,
          capabilities: ['thinking', 'always_thinking', 'tool_use'],
          supportEfforts: ['low', 'high', 'max'],
        },
        'omnicode/toggle': {
          provider: 'omnicode',
          model: 'omnicode-for-coding',
          maxContextSize: 128_000,
          capabilities: ['thinking'],
        },
        'omnicode/custom': {
          provider: 'omnicode',
          model: 'omnicode-custom-coder',
          maxContextSize: 128_000,
          capabilities: ['thinking'],
          supportEfforts: ['low', 'medium', 'max'],
          defaultEffort: 'max',
        },
        'omnicode/ultra': {
          provider: 'omnicode',
          model: 'omnicode-ultra',
          maxContextSize: 128_000,
          capabilities: ['thinking'],
          supportEfforts: ['low', 'high', 'ultra'],
          defaultEffort: 'ultra',
        },
        'omnicode/compatible': {
          provider: 'omnicode',
          protocol: 'anthropic',
          model: 'compatible-model',
          maxContextSize: 128_000,
          capabilities: ['thinking', 'always_thinking'],
          supportEfforts: ['max'],
          defaultEffort: 'max',
        } as TestProtocolModelConfig,
      },
    };
    capturedThinking = undefined;
    ctx = createTestAgent(
      configServices(() => omnicodeConfig),
      llmGenerateServices(requesterFromGenerateFn(async (_provider, _systemPrompt, _tools, _history, _callbacks, options) => {
        capturedThinking = options?.thinking;
        return {
          id: 'response-1',
          message: { role: 'assistant', content: [], toolCalls: [] },
          usage: emptyUsage(),
          finishReason: 'completed',
          rawFinishReason: 'stop',
        };
      })),
    );
    profile = ctx.get(IAgentProfileService);
    requester = ctx.get(IAgentLLMRequesterService);
  });

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  it('clamps thinkingLevel off to the configured effort', () => {
    profile.update({ modelAlias: 'omnicode/deep', thinkingLevel: 'off' });

    expect(profile.data().thinkingLevel).toBe('high');
  });

  it('sends the clamped thinking effort in the per-turn intent after thinking was set off', async () => {
    profile.update({ modelAlias: 'omnicode/deep', thinkingLevel: 'off' });

    await requester.request({}, undefined, new AbortController().signal);

    expect(capturedThinking).toMatchObject({ effort: 'high' });
  });

  it('keeps thinking off working for toggleable models', () => {
    profile.update({ modelAlias: 'omnicode/toggle', thinkingLevel: 'off' });

    expect(profile.data().thinkingLevel).toBe('off');
  });

  it('resolves an explicit on request to the model default effort', () => {
    profile.update({ modelAlias: 'omnicode/custom', thinkingLevel: 'on' });

    expect(profile.data().thinkingLevel).toBe('max');
  });

  it('re-clamps when switching to an always-on model after thinking was off', () => {
    profile.update({ modelAlias: 'omnicode/toggle', thinkingLevel: 'off' });
    expect(profile.data().thinkingLevel).toBe('off');

    profile.update({ modelAlias: 'omnicode/deep' });
    expect(profile.data().thinkingLevel).toBe('high');
  });

  it('falls back to the target default when a model switch carries an unsupported effort', () => {
    profile.update({ modelAlias: 'omnicode/ultra', thinkingLevel: 'ultra' });

    profile.update({ modelAlias: 'omnicode/custom' });

    expect(profile.data().thinkingLevel).toBe('max');
  });

  it('projects an inherited concrete effort to on when switching to a boolean model', () => {
    profile.update({ modelAlias: 'omnicode/ultra', thinkingLevel: 'ultra' });

    profile.update({ modelAlias: 'omnicode/toggle' });

    expect(profile.data().thinkingLevel).toBe('on');
  });

  it('rejects an unsupported effort explicitly set on the current Omnicode model', () => {
    profile.update({ modelAlias: 'omnicode/custom' });

    expect(() => {
      profile.setThinking('ultra');
    }).toThrow(
      'Thinking effort "ultra" is not supported by model "omnicode/custom"',
    );
  });

  it.each([
    [' HIGH ', 'high'],
    ['OFF', 'off'],
  ])('normalizes runtime effort %j to %s before validation', (input, expected) => {
    profile.update({ modelAlias: 'omnicode/ultra' });

    profile.setThinking(input);

    expect(profile.data().thinkingLevel).toBe(expected);
  });

  it('uses the model default when the runtime effort is blank', () => {
    profile.update({ modelAlias: 'omnicode/custom', thinkingLevel: 'low' });

    profile.setThinking('   ');

    expect(profile.data().thinkingLevel).toBe('max');
  });

  it('preserves unlisted efforts with a warning for Omnicode-managed Anthropic models', () => {
    profile.update({ modelAlias: 'omnicode/compatible', thinkingLevel: 'max' });

    expect(() => {
      profile.setThinking('high');
    }).not.toThrow();
    expect(profile.data().thinkingLevel).toBe('high');
    expect(ctx.allEvents).toContainEqual({
      type: '[rpc]',
      event: 'warning',
      args: expect.objectContaining({
        code: 'anthropic-thinking-effort-not-listed',
        message:
          'Thinking effort "high" is not listed for model "compatible-model" (known: max). The configured value will be sent unchanged to the Anthropic-compatible backend.',
      }),
    });
  });

  it('clamps off to the model default for always-on models, on any transport', () => {
    profile.update({ modelAlias: 'omnicode/compatible', thinkingLevel: 'max' });

    expect(() => {
      profile.setThinking('off');
    }).not.toThrow();
    expect(profile.data().thinkingLevel).toBe('max');
  });
});

describe('ConfigState.provider applies global OMNICODE_MODEL_* request config', () => {
  let ctx: TestAgentContext | undefined;
  let profile: IAgentProfileService;
  let requester: IAgentLLMRequesterService;
  let omnicodeConfig: TestOmnicodeConfig;
  let capturedProvider: unknown;
  let capturedOptions: Parameters<LegacyGenerateFn>[5];

  beforeEach(() => {
    omnicodeConfig = {
      providers: { omnicode: { type: 'omnicode', apiKey: 'test-key', baseUrl: 'https://api.example.test/v1' } },
      models: {
        'omnicode': {
          provider: 'omnicode',
          model: 'omnicode',
          maxContextSize: 128_000,
          capabilities: ['thinking'],
        },
        'omnicode-anthropic': {
          provider: 'omnicode',
          protocol: 'anthropic',
          model: 'omnicode-anthropic',
          maxContextSize: 128_000,
          capabilities: ['thinking'],
          supportEfforts: ['low', 'high'],
        } as TestProtocolModelConfig,
      },
    };
    capturedProvider = undefined;
  });

  afterEach(async () => {
    try {
      await ctx?.expectResumeMatches();
    } finally {
      await ctx?.dispose();
      ctx = undefined;
      vi.unstubAllEnvs();
    }
  });

  function createAgentWithEnv(): void {
    ctx = createTestAgent(
      configServices(() => omnicodeConfig),
      llmGenerateServices(requesterFromGenerateFn(async (provider, _systemPrompt, _tools, _history, _callbacks, options) => {
        capturedProvider = provider;
        capturedOptions = options;
        return {
          id: 'response-1',
          message: { role: 'assistant', content: [], toolCalls: [] },
          usage: emptyUsage(),
          finishReason: 'completed',
          rawFinishReason: 'stop',
        };
      })),
    );
    profile = ctx.get(IAgentProfileService);
    requester = ctx.get(IAgentLLMRequesterService);
  }

  it('injects OMNICODE_MODEL_TEMPERATURE into the per-turn sampling intent (the compaction request also uses)', async () => {
    vi.stubEnv('OMNICODE_MODEL_TEMPERATURE', '0.3');
    createAgentWithEnv();

    profile.update({ modelAlias: 'omnicode' });
    await requester.request({}, undefined, new AbortController().signal);

    expect(capturedOptions?.sampling).toMatchObject({
      temperature: 0.3,
    });
  });

  it('injects OMNICODE_MODEL_THINKING_KEEP into the per-turn thinking intent when thinking is on (so compaction keeps it)', async () => {
    vi.stubEnv('OMNICODE_MODEL_THINKING_KEEP', 'all');
    createAgentWithEnv();

    profile.update({ modelAlias: 'omnicode', thinkingLevel: 'high' });
    await requester.request({}, undefined, new AbortController().signal);

    expect(capturedOptions?.thinking).toMatchObject({ effort: 'on', keep: 'all' });
  });

  it('does NOT inject thinking.keep into the per-turn intent when thinking is off', async () => {
    vi.stubEnv('OMNICODE_MODEL_THINKING_KEEP', 'all');
    createAgentWithEnv();

    profile.update({ modelAlias: 'omnicode', thinkingLevel: 'off' });
    await requester.request({}, undefined, new AbortController().signal);

    expect(capturedOptions?.thinking?.effort).toBe('off');
    expect(capturedOptions?.thinking?.keep).toBeUndefined();
  });

  it('injects forced effort through the Anthropic protocol for a Omnicode provider', async () => {
    vi.stubEnv('OMNICODE_MODEL_THINKING_EFFORT', 'max');
    createAgentWithEnv();

    profile.update({ modelAlias: 'omnicode-anthropic', thinkingLevel: 'high' });
    expect(profile.data().thinkingLevel).toBe('high');
    expect(profile.resolveModelContext().thinkingLevel).toBe('max');
    const statusEvent = ctx?.allEvents.findLast(
      (event) =>
        event.event === 'agent.status.updated' &&
        (event.args as { thinkingEffort?: unknown } | undefined)?.thinkingEffort !== undefined,
    );
    expect(statusEvent?.args).toMatchObject({
      model: 'omnicode-anthropic',
      thinkingEffort: 'max',
    });

    await requester.request({}, undefined, new AbortController().signal);

    expect(capturedProvider).toMatchObject({ name: 'anthropic' });
    expect(capturedOptions?.thinking?.effort).toBe('max');
  });
});
