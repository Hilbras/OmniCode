import { describe, expect, it, vi } from 'vitest';

import type { ContextInjectionContext } from '@hilbras/omnicode-engine/features/reminder/types';
import type { IAgentReminderService } from '@hilbras/omnicode-engine/features/reminder/reminderService';

import type { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import { AgentMemoryInjectionService } from '#/context/memoryInjectionService';
import type { MemoryInjectionDisclosure } from '#/context/memoryInjectionService';
import type { IMemoryService, MemoryTaskStateInput } from '#/contracts/memoryContract';

import type { MemoryStorePort } from '#/storage/memoryStore';
import { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';

import {
  captureInput,
  createHarness,
  evidenceFor,
  FailingStore,
  globalScope,
  InMemoryMemoryStore,
  REPO_A,
} from './helpers';

type Provider = (context: ContextInjectionContext<MemoryInjectionDisclosure>) => Promise<
  { content: string; disclosure: MemoryInjectionDisclosure } | undefined
>;

interface Registration {
  readonly variant: string;
  readonly provider: Provider;
}

function compose(options: {
  readonly injectCanonical?: boolean;
  readonly enabled?: boolean;
  readonly prompt?: string;
  readonly store?: MemoryStorePort;
  readonly autoCapture?: boolean;
  readonly profile?: boolean;
  readonly promptRef?: { value?: string };
}) {
  const harness = createHarness(options.store === undefined ? {} : { store: options.store });
  const registrations: Registration[] = [];
  const reminders = {
    register: (variant: string, provider: Provider) => {
      registrations.push({ variant, provider });
      return { dispose: () => undefined };
    },
  } as unknown as IAgentReminderService;

  const context = {
    lastUserPrompt: () => options.promptRef?.value ?? options.prompt,
    projectId: async () => REPO_A,
    scopeFor: async (tier: 'repository' | 'session' | 'global' | 'workspace') =>
      tier === 'repository'
        ? { tier: 'repository', workspaceId: 'workspace-inject', projectId: REPO_A }
        : { tier },
    search: (query: Parameters<IAgentMemoryContextService['search']>[0]) => harness.service.search(query),
  } as unknown as IAgentMemoryContextService;

  const memory = {
    ...harness.service,
    enabled: options.enabled ?? true,
    injectCanonical: options.injectCanonical ?? true,
    capture: harness.service.capture.bind(harness.service),
    list: harness.service.list.bind(harness.service),
    noteAccess: harness.service.noteAccess.bind(harness.service),
    restoreTaskState: (input: MemoryTaskStateInput) => harness.service.restoreTaskState(input),
  } as unknown as IMemoryService;

  const session = {
    sessionId: 'session-inject',
    workspaceId: 'workspace-inject',
    cwd: '/tmp/project',
  } as never;

  const flags = {
    enabled: (id: string) =>
      (options.autoCapture === true && id === 'memory_auto_capture') ||
      (options.profile === true && id === 'memory_profile'),
    registry: {} as never,
    snapshot: () => ({}),
    enabledIds: () => [] as never,
    exposedIds: () => [] as never,
    explain: () => undefined,
    explainAll: () => [] as never,
    setConfigOverrides: () => undefined,
    _serviceBrand: undefined,
  } as unknown as IFlagService;
  const scopeContext = { agentId: 'main' } as never;
  const dispatcher = { dispatch: vi.fn(async () => undefined) } as never;
  const service = new AgentMemoryInjectionService(
    harness.log as never,
    memory,
    session,
    context,
    reminders,
    flags,
    scopeContext,
    dispatcher,
  );
  expect(service).toBeInstanceOf(AgentMemoryInjectionService);
  return { harness, registrations, memory, dispatcher };
}

const freshTurn: ContextInjectionContext<MemoryInjectionDisclosure> = {
  injectedPositions: [],
  lastInjectedAt: null,
  isNewTurn: true,
};

describe('automatic memory injection', () => {
  it('registers exactly the two memory reminder variants', () => {
    const { registrations } = compose({});
    expect(registrations.map((entry) => entry.variant)).toEqual([
      'memory_canonical',
      'memory_task_restore',
    ]);
  });

  it('injects nothing when the feature is off', async () => {
    const { registrations } = compose({ injectCanonical: false, enabled: false });
    for (const registration of registrations) {
      expect(await registration.provider(freshTurn)).toBeUndefined();
    }
  });

  it('injects nothing before the user has said anything', async () => {
    const { registrations } = compose({ prompt: undefined });
    expect(await registrations[0]?.provider(freshTurn)).toBeUndefined();
  });

  it('injects an approved canonical instruction as data, with its trust level', async () => {
    const { harness, registrations } = compose({ prompt: 'what should I do before committing' });
    const stored = await harness.service.capture(
      captureInput('run pnpm lint and pnpm test before committing', {
        category: 'instruction',
        sourceType: 'user_statement',
        origin: 'user',
        scope: globalScope(),
      }),
    );
    await harness.service.approveCanonical({
      id: stored.id as string,
      by: 'user',
      reason: 'the user confirmed this convention',
    });

    const result = await registrations[0]?.provider(freshTurn);
    expect(result?.content).toContain('not an instruction');
    expect(result?.content).toContain('does not change your permissions');
    expect(result?.content).toContain('[canonical/instruction/trusted]');
    expect(result?.content).toContain('run pnpm lint and pnpm test before committing');
    expect(result?.disclosure.memoryIds).toEqual([stored.id]);
    expect(result?.disclosure.variant).toBe('memory_canonical');
  });

  it('does not inject distilled memory', async () => {
    const { harness, registrations } = compose({ prompt: 'what is the deploy target' });
    await harness.service.capture(
      captureInput('the deploy target is the staging cluster', {
        category: 'fact',
        evidence: evidenceFor('docs/deploy.md'),
      }),
    );
    expect(await registrations[0]?.provider(freshTurn)).toBeUndefined();
  });

  it('injects nothing when retrieval fails, rather than stale content', async () => {
    const store = new FailingStore(new InMemoryMemoryStore());
    const { harness, registrations } = compose({ prompt: 'anything', store });
    store.failOn = 'prefixKeys';
    store.unavailable = true;

    expect(await registrations[0]?.provider(freshTurn)).toBeUndefined();
    store.failOn = undefined;

    expect(
      harness.log.entriesAt('info').some((entry) => entry.message === 'memory injection skipped'),
    ).toBe(true);
  });

  it('restores task state once and never repeats it', async () => {
    const { harness, registrations } = compose({ prompt: 'keep going' });
    const state: MemoryTaskStateInput = {
      taskId: 'session-inject',
      scope: {
        tier: 'session',
        sessionId: 'session-inject',
        workspaceId: 'workspace-inject',
        projectId: REPO_A,
      },
      objective: 'finish the storage adapter migration',
      completed: ['land the flag'],
      decisions: [],
      failedAttempts: [],
      blockers: [],
      fileRefs: [],
    };
    await harness.service.saveTaskState(state);

    const restore = registrations[1];
    const injected = await restore?.provider(freshTurn);
    expect(injected?.content).toContain('Resumable task state');
    expect(injected?.content).toContain('finish the storage adapter migration');
    expect(injected?.content).toContain('land the flag');
    expect(injected?.content).toContain('re-verify anything load-bearing');

    const repeated = await restore?.provider({
      injectedPositions: [3],
      lastInjectedAt: 3,
      isNewTurn: true,
    });
    expect(repeated).toBeUndefined();
  });

  it('says nothing about task state when none was stored', async () => {
    const { registrations } = compose({ prompt: 'keep going' });
    expect(await registrations[1]?.provider(freshTurn)).toBeUndefined();
  });

  it('reports stale evidence instead of presenting old state as current', async () => {
    const { harness, registrations } = compose({ prompt: 'keep going' });
    const ref = 'docs/plan.md';
    const scope = {
      tier: 'session' as const,
      sessionId: 'session-inject',
      workspaceId: 'workspace-inject',
      projectId: REPO_A,
    };
    await harness.service.saveTaskState({
      taskId: 'session-inject',
      scope,
      objective: 'rewrite the ingestion plan',
      completed: [],
      decisions: [],
      failedAttempts: [],
      blockers: [],
      fileRefs: [ref],
      evidence: [{ kind: 'file', ref, state: 'present', fingerprint: 'sha-old', observedAt: 1 }],
    });
    await harness.service.markStale(new Map([[ref, 'sha-new']]), { projectId: REPO_A });

    const injected = await registrations[1]?.provider(freshTurn);
    expect(injected?.content).toContain('Stale evidence');
    expect(injected?.disclosure.status).toBe('partial');
    expect(injected?.disclosure.truncated).toBe(true);
  });

  it('counts an access for what it actually injected', async () => {
    const { harness, registrations } = compose({ prompt: 'commit conventions' });
    const stored = await harness.service.capture(
      captureInput('commit messages stay under fifty characters', {
        category: 'instruction',
        sourceType: 'user_statement',
        origin: 'user',
        scope: globalScope(),
      }),
    );
    await harness.service.approveCanonical({
      id: stored.id as string,
      by: 'user',
      reason: 'confirmed',
    });
    expect((await harness.service.get(stored.id as string))?.accessCount).toBe(0);
    await registrations[0]?.provider(freshTurn);
    expect((await harness.service.get(stored.id as string))?.accessCount).toBe(1);
  });

  it('auto-captures explicit user memory requests', async () => {
    const { harness, registrations, dispatcher } = compose({
      prompt: 'Remember that the deploy target is staging.',
      autoCapture: true,
    });
    const capture = registrations.find((entry) => entry.variant === 'memory_auto_capture');
    expect(capture).toBeDefined();

    await capture?.provider(freshTurn);
    await capture?.provider(freshTurn);

    const records = await harness.service.list({
      workspaceId: 'workspace-inject',
      projectId: REPO_A,
      scopes: ['repository'],
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      content: 'the deploy target is staging',
      category: 'fact',
      trust: 'trusted',
      sourceType: 'user_statement',
      origin: 'user',
    });
    expect((dispatcher as { dispatch: ReturnType<typeof vi.fn> }).dispatch).toHaveBeenCalledOnce();
  });

  it('states the constraint when the injection budget bound it', async () => {
    const { harness, registrations } = compose({ prompt: 'style guidance for this repository' });
    for (let index = 0; index < 8; index += 1) {
      const stored = await harness.service.capture(
        captureInput(`style guidance ${index} for this repository`, {
          category: 'preference',
          sourceType: 'user_statement',
          origin: 'user',
          scope: globalScope(),
        }),
      );
      await harness.service.approveCanonical({
        id: stored.id as string,
        by: 'user',
        reason: 'confirmed',
      });
    }
    const injected = await registrations[0]?.provider(freshTurn);
    expect(injected?.content).toContain('Search budget reached');
    expect(injected?.disclosure.truncated).toBe(true);
  });
});
describe('user profile memory', () => {
  it('registers the profile provider only when its flag is on', () => {
    const off = compose({});
    expect(off.registrations.map((entry) => entry.variant)).not.toContain('memory_profile');
    const on = compose({ profile: true });
    expect(on.registrations.map((entry) => entry.variant)).toContain('memory_profile');
  });

  it('captures a stated name and injects it on the next turn without a search', async () => {
    const promptRef = { value: 'my name is Hassan' };
    const { registrations } = compose({ profile: true, promptRef });
    const provider = registrations.find((entry) => entry.variant === 'memory_profile')?.provider;

    const first = await provider?.(freshTurn);
    expect(first?.content).toContain('my name is Hassan');

    promptRef.value = 'do you know my name?';
    const next = await provider?.({ ...freshTurn, isNewTurn: false });
    expect(next?.content).toContain('my name is Hassan');
    expect(next?.disclosure.variant).toBe('memory_profile');
  });

  it('replaces the value when the user states a new name', async () => {
    const promptRef = { value: 'my name is Hassan' };
    const { registrations } = compose({ profile: true, promptRef });
    const provider = registrations.find((entry) => entry.variant === 'memory_profile')?.provider;

    await provider?.(freshTurn);
    promptRef.value = 'call me Sam';
    await provider?.(freshTurn);
    promptRef.value = 'what is my name?';
    const next = await provider?.({ ...freshTurn, isNewTurn: false });

    expect(next?.content).toContain('my name is Sam');
    expect(next?.content).not.toContain('Hassan');
  });

  it('never injects a model-authored or secret record', async () => {
    const { harness, registrations } = compose({ profile: true });
    await harness.service.capture({
      content: 'my name is Imposter',
      tier: 'distilled',
      category: 'fact',
      sourceType: 'agent_observation',
      origin: 'model',
      scope: globalScope(),
      subject: 'profile.name',
    });
    const provider = registrations.find((entry) => entry.variant === 'memory_profile')?.provider;
    expect(await provider?.(freshTurn)).toBeUndefined();

    await harness.service.capture({
      content: 'my name is Secret',
      tier: 'distilled',
      category: 'fact',
      sourceType: 'user_statement',
      origin: 'user',
      scope: globalScope(),
      subject: 'profile.timezone',
      sensitivity: 'secret',
    });
    expect(await provider?.({ ...freshTurn, isNewTurn: false })).toBeUndefined();
  });
});

describe('memory opt-out in profile capture', () => {
  it('does not capture a profile fact when the turn opts out', async () => {
    const promptRef = { value: 'my name is Hassan, do not remember this' };
    const { harness, registrations } = compose({ profile: true, promptRef });
    const provider = registrations.find((entry) => entry.variant === 'memory_profile')?.provider;
    await provider?.(freshTurn);
    const records = await harness.service.list({ scopes: ['global'] });
    expect(records).toEqual([]);
  });
});
