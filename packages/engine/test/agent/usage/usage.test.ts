import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '@hilbras/omnicode-base/di/descriptors';
import { DisposableStore } from '@hilbras/omnicode-base/di/lifecycle';
import { TestInstantiationService } from '@hilbras/omnicode-base/di/test';
import type { AgentContext } from '#/agent/agentContext/agentContext';
import { IAgentScopeContext, makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStateService } from '#/agent/state/agentStateService';
import { AgentCacheProbeService } from '#/agent/usage/cacheProbeService';
import { AgentCostGateService } from '#/agent/usage/costGateService';
import { AgentCostLedgerService } from '#/agent/usage/costLedgerService';
import {
  type UsageRecordedContext,
  type UsageStatus,
} from '#/agent/usage/usage';
import { ISessionUsageService } from '#/session/usage/sessionUsage';
import { SessionUsageService } from '#/session/usage/sessionUsageService';
import type { Event2 } from '#/app/event/event2';
import type { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IModelCatalog, type Model } from '#/llm-adapter/model/catalog';
import { AppendLogStore } from '#/persistence/backends/node-fs/appendLogStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { IEventDispatcher } from '#/state/eventDispatcher';
import { AGENT_WIRE_RECORD_KEY, type WireRecord } from '#/wire/record';

import {
  registerTestAgentWire,
  registerTestEventDispatcher,
  restoreTestEventDispatcher,
  testWireScope,
} from '../../wire/stubs';

const SCOPE = 'wire';
const KEY = 'usage-test';

let disposables: DisposableStore;
let ix: TestInstantiationService;
let log: IAppendLogStore;
let dispatcher: IEventDispatcher;
let svc: ISessionUsageService;
let agent: AgentContext;

beforeEach(() => {
  disposables = new DisposableStore();
  ix = disposables.add(new TestInstantiationService());
  ix.stub(IFileSystemStorageService, new InMemoryStorageService());
  ix.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
  ix.set(IAgentStateService, new AgentStateService());
  ix.set(IEventBus, new SyncDescriptor(EventBusService));
  ix.set(ISessionUsageService, new SyncDescriptor(SessionUsageService));
  log = ix.get(IAppendLogStore);
  registerTestAgentWire(ix, testWireScope(SCOPE, KEY), {
    log,
    eventBus: ix.get(IEventBus),
  });
  dispatcher = registerTestEventDispatcher(ix);
  svc = ix.get(ISessionUsageService);
  agent = ix.get(IAgentScopeContext).agentContext;
});

afterEach(() => disposables.dispose());

async function readRecords(): Promise<WireRecord[]> {
  await dispatcher.flush();
  const out: WireRecord[] = [];
  for await (const record of log.read<WireRecord>(testWireScope(SCOPE, KEY), AGENT_WIRE_RECORD_KEY)) {
    out.push(record);
  }
  return out;
}

function createFreshHost(logKey: string): {
  readonly dispatcher: IEventDispatcher;
  readonly usage: ISessionUsageService;
  readonly agent: AgentContext;
  readonly freshLog: IAppendLogStore;
} {
  const freshIx = disposables.add(new TestInstantiationService());
  freshIx.stub(IFileSystemStorageService, new InMemoryStorageService());
  freshIx.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
  freshIx.set(ISessionUsageService, new SyncDescriptor(SessionUsageService));
  const freshLog = freshIx.get(IAppendLogStore);
  registerTestAgentWire(freshIx, testWireScope(SCOPE, logKey), {
    log: freshLog,
  });
  const freshDispatcher = registerTestEventDispatcher(freshIx);
  return {
    dispatcher: freshDispatcher,
    usage: freshIx.get(ISessionUsageService),
    agent: freshIx.get(IAgentScopeContext).agentContext,
    freshLog,
  };
}

const a1 = { inputOther: 1, output: 2, inputCacheRead: 3, inputCacheCreation: 4 };
const a2 = { inputOther: 10, output: 20, inputCacheRead: 30, inputCacheCreation: 40 };
const b1 = { inputOther: 100, output: 200, inputCacheRead: 300, inputCacheCreation: 400 };

describe('SessionUsageService (wire-backed)', () => {
  it('accumulates usage by model', async () => {
    await svc.record(agent, 'model-a', a1);
    await svc.record(agent, 'model-a', a2);
    await svc.record(agent, 'model-b', b1);

    expect(svc.status(agent)).toEqual({
      byModel: {
        'model-a': { inputOther: 11, output: 22, inputCacheRead: 33, inputCacheCreation: 44 },
        'model-b': b1,
      },
      total: { inputOther: 111, output: 222, inputCacheRead: 333, inputCacheCreation: 444 },
      currentTurn: undefined,
    });
  });

  it('tracks current turn usage by turn id', async () => {
    await svc.record(agent, 'model-a', a1);
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 1 });
    await svc.record(agent, 'model-b', b1, { type: 'turn', turnId: 1 });

    expect(svc.status(agent)).toMatchObject({
      total: { inputOther: 111, output: 222, inputCacheRead: 333, inputCacheCreation: 444 },
      currentTurn: { inputOther: 110, output: 220, inputCacheRead: 330, inputCacheCreation: 440 },
    });

    await svc.record(agent, 'model-a', { inputOther: 5, output: 6, inputCacheRead: 7, inputCacheCreation: 8 }, {
      type: 'turn',
      turnId: 2,
    });

    expect(svc.status(agent).currentTurn).toEqual({
      inputOther: 5,
      output: 6,
      inputCacheRead: 7,
      inputCacheCreation: 8,
    });
  });

  it('returns immutable status snapshots', async () => {
    await svc.record(agent, 'model-a', a1);
    const snapshot = svc.status(agent);

    await svc.record(agent, 'model-a', a2);

    expect(snapshot).toEqual({
      byModel: { 'model-a': a1 },
      total: a1,
      currentTurn: undefined,
    });
  });

  it('emits agent.status.updated with the usage snapshot after each live record', async () => {
    const events: Event2[] = [];
    disposables.add(ix.get(IEventBus).subscribe((e) => events.push(e)));

    await svc.record(agent, 'model-a', a1);

    expect(events).toEqual([
      expect.objectContaining({
        type: 'agent.status.updated',
        usage: {
          byModel: { 'model-a': a1 },
          total: a1,
          currentTurn: undefined,
        } satisfies UsageStatus,
      }),
    ]);
  });

  it('fires onDidRecord with the live usage context', async () => {
    const contexts: UsageRecordedContext[] = [];
    disposables.add(
      svc.onDidRecord((ctx) => {
        contexts.push(ctx);
      }),
    );

    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 7, step: 2 });

    expect(contexts).toEqual([
      {
        agent,
        model: 'model-a',
        usage: a1,
        source: { type: 'turn', turnId: 7, step: 2 },
        firstRecord: true,
      },
    ]);
  });

  it('marks firstRecord on the first live record only', async () => {
    const contexts: UsageRecordedContext[] = [];
    disposables.add(svc.onDidRecord((ctx) => contexts.push(ctx)));

    await svc.record(agent, 'model-a', a1);
    await svc.record(agent, 'model-b', b1);
    await svc.record(agent, 'model-a', a2);

    expect(contexts.map((ctx) => ctx.firstRecord)).toEqual([true, false, false]);
  });

  it('does not mark firstRecord when usage was restored from persisted records', async () => {
    await svc.record(agent, 'model-a', a1);
    const records = await readRecords();

    const fresh = createFreshHost('usage-first-record-replay');
    await restoreTestEventDispatcher(
      fresh.dispatcher,
      fresh.freshLog,
      testWireScope(SCOPE, 'usage-first-record-replay'),
      records,
    );

    const contexts: UsageRecordedContext[] = [];
    disposables.add(fresh.usage.onDidRecord((ctx) => contexts.push(ctx)));
    await fresh.usage.record(fresh.agent, 'model-a', a2);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.firstRecord).toBe(false);
  });

  it('rejects a context the lifecycle never issued', async () => {
    const forged = { agentId: agent.agentId, generation: agent.generation } as AgentContext;

    await expect(svc.record(forged, 'model-a', a1)).rejects.toThrow(
      'is not a lifecycle-issued context',
    );
    expect(() => svc.status(forged)).toThrow('is not a lifecycle-issued context');
  });

  it('dispatch persists flat { type, model, usage, usageScope } records (no payload key)', async () => {
    await svc.record(agent, 'model-a', a1);

    const records = await readRecords();
    expect(records).toEqual([
      {
        type: 'usage.record',
        agentId: 'test-agent',
        model: 'model-a',
        usage: a1,
        usageScope: 'session',
        time: expect.any(Number),
      },
    ]);
    expect('payload' in records[0]!).toBe(false);
  });

  it('marks turn-scoped sources with usageScope only (no turnId or context persisted)', async () => {
    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 7, step: 2 });

    const records = await readRecords();
    expect(records).toEqual([
      {
        type: 'usage.record',
        agentId: 'test-agent',
        model: 'model-a',
        usage: a1,
        usageScope: 'turn',
        time: expect.any(Number),
      },
    ]);
  });

  it('replay rebuilds usage from persisted records on a fresh dispatcher (silent)', async () => {
    await svc.record(agent, 'model-a', a1);
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 1 });
    const records = await readRecords();

    const fresh = createFreshHost('usage-replay');

    await restoreTestEventDispatcher(
      fresh.dispatcher,
      fresh.freshLog,
      testWireScope(SCOPE, 'usage-replay'),
      records,
    );

    expect(fresh.usage.status(fresh.agent).byModel).toEqual({
      'model-a': { inputOther: 11, output: 22, inputCacheRead: 33, inputCacheCreation: 44 },
    });

    const written: WireRecord[] = [];
    for await (const record of fresh.freshLog.read<WireRecord>(testWireScope(SCOPE, 'usage-replay'), AGENT_WIRE_RECORD_KEY)) {
      written.push(record);
    }
    expect(written[0]).toMatchObject({ type: 'metadata' });
    expect(written.slice(1)).toEqual(records);
  });

  it('replays legacy turn context records into byModel totals only (currentTurn is not rebuilt)', async () => {
    const fresh = createFreshHost('usage-legacy-context-replay');

    await restoreTestEventDispatcher(
      fresh.dispatcher,
      fresh.freshLog,
      testWireScope(SCOPE, 'usage-legacy-context-replay'),
      [{
        type: 'usage.record',
        model: 'model-a',
        usage: a1,
        usageScope: 'turn',
        turnId: 1,
        context: { type: 'turn', turnId: 9, step: 3 },
      }],
    );

    expect(fresh.usage.status(fresh.agent)).toEqual({
      byModel: { 'model-a': a1 },
      total: a1,
      currentTurn: undefined,
    });
  });
});

describe('AgentCacheProbeService', () => {
  function stubProbeDeps(forkedFrom: string | undefined): ReturnType<typeof vi.fn> {
    const track2 = vi.fn();
    ix.stub(ITelemetryService, {
      _serviceBrand: undefined,
      track2,
    } as unknown as ITelemetryService);
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: (alias: string) => {
        if (alias !== 'model-a') throw new Error(`unknown model "${alias}"`);
        return { id: alias, protocol: 'anthropic', providerType: 'omnicode' } as unknown as Model;
      },
    } as unknown as IModelCatalog);
    ix.stub(
      IAgentScopeContext,
      makeAgentScopeContext({ agentId: 'test-agent', agentScope: '', forkedFrom }),
    );
    return track2;
  }

  it('probes the first turn request of a forked agent', async () => {
    const track2 = stubProbeDeps('main');
    disposables.add(ix.createInstance(AgentCacheProbeService));

    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });

    expect(track2).toHaveBeenCalledTimes(1);
    expect(track2).toHaveBeenCalledWith('prompt_cache_probe', {
      source: 'fork',
      turn_id: 1,
      provider_type: 'omnicode',
      protocol: 'anthropic',
      input_tokens: 8,
      input_cache_read: 3,
      input_cache_creation: 4,
      output_tokens: 2,
    });
  });

  it('probes only once', async () => {
    const track2 = stubProbeDeps('main');
    disposables.add(ix.createInstance(AgentCacheProbeService));

    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 2 });

    expect(track2).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a non-forked agent', async () => {
    const track2 = stubProbeDeps(undefined);
    disposables.add(ix.createInstance(AgentCacheProbeService));

    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });

    expect(track2).not.toHaveBeenCalled();
  });

  it('stays silent when the first record is not a turn request', async () => {
    const track2 = stubProbeDeps('main');
    disposables.add(ix.createInstance(AgentCacheProbeService));

    await svc.record(agent, 'model-a', a1);
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 1 });

    expect(track2).not.toHaveBeenCalled();
  });

  it('probes without provider fields when the model alias is unknown', async () => {
    const track2 = stubProbeDeps('main');
    disposables.add(ix.createInstance(AgentCacheProbeService));

    await svc.record(agent, 'model-b', b1, { type: 'turn', turnId: 1 });

    expect(track2).toHaveBeenCalledWith('prompt_cache_probe', {
      source: 'fork',
      turn_id: 1,
      provider_type: undefined,
      protocol: undefined,
      input_tokens: 800,
      input_cache_read: 300,
      input_cache_creation: 400,
      output_tokens: 200,
    });
  });
});

describe('AgentCostLedgerService', () => {
  const PRICED_CONFIG = {
    costLimits: { modelPrices: { 'model-a': { inputPerMillionUsd: 1, outputPerMillionUsd: 10 } } },
  };

  function gateWith(config: Record<string, unknown>): AgentCostGateService {
    const configService = { get: (domain: string) => config[domain] } as unknown as IConfigService;
    return new AgentCostGateService(configService);
  }

  function createLedger(config: Record<string, unknown> = PRICED_CONFIG): AgentCostLedgerService {
    return disposables.add(
      new AgentCostLedgerService(svc, ix.get(IAgentScopeContext), gateWith(config)),
    );
  }

  it('accumulates turn spend and derives the session total from persisted usage', async () => {
    const ledger = createLedger();
    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 1 });

    const status = ledger.status();
    expect(status.unknownPricing).toBe(false);
    expect(status.liveRecords).toBe(2);
    expect(status.spentUsd).toBeCloseTo(0.000308, 9);
    expect(status.turns['1']).toBeCloseTo(0.000308, 9);
    expect(status.currentTurn).toEqual({ turnId: 1, spentUsd: status.turns['1'] });
    expect(status.goals).toEqual({});
  });

  it('reports session spend for usage recorded before the ledger existed', async () => {
    await svc.record(agent, 'model-a', a1);
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 1 });

    const ledger = createLedger();

    const status = ledger.status();
    expect(status.spentUsd).toBeCloseTo(0.000308, 9);
    expect(status.liveRecords).toBe(0);
    expect(status.turns).toEqual({});
  });

  it('keeps per-goal spend across attribution before, between, and after records', async () => {
    const ledger = createLedger();
    ledger.attributeGoalTurn('goal-1', 1);
    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });
    await svc.record(agent, 'model-a', a2, { type: 'turn', turnId: 2 });
    ledger.attributeGoalTurn('goal-2', 2);

    const status = ledger.status();
    expect(status.goals['goal-1']).toBeCloseTo(0.000028, 9);
    expect(status.goals['goal-2']).toBeCloseTo(0.00028, 9);
  });

  it('moves a turn to a newly attributed goal without double counting', async () => {
    const ledger = createLedger();
    ledger.attributeGoalTurn('goal-1', 1);
    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });
    ledger.attributeGoalTurn('goal-1', 1);
    ledger.attributeGoalTurn('goal-3', 1);

    const status = ledger.status();
    expect(status.goals['goal-1']).toBeUndefined();
    expect(status.goals['goal-3']).toBeCloseTo(0.000028, 9);
  });

  it('flags unknown pricing without dropping priced models from the totals', async () => {
    const ledger = createLedger();
    await svc.record(agent, 'model-a', a1, { type: 'turn', turnId: 1 });
    await svc.record(agent, 'model-b', b1, { type: 'turn', turnId: 1 });

    const status = ledger.status();
    expect(status.unknownPricing).toBe(true);
    expect(status.spentUsd).toBeCloseTo(0.000028, 9);
    expect(status.turns['1']).toBeCloseTo(0.000028, 9);
  });

  it('lists an unpriced-only turn as zero spend in both the turn map and the current turn', async () => {
    const ledger = createLedger();
    await svc.record(agent, 'model-b', b1, { type: 'turn', turnId: 4 });

    const status = ledger.status();
    expect(status.unknownPricing).toBe(true);
    expect(status.spentUsd).toBe(0);
    expect(status.turns['4']).toBe(0);
    expect(status.currentTurn).toEqual({ turnId: 4, spentUsd: 0 });
  });

  it('reports no spend and no unknown pricing before any usage is recorded', () => {
    const ledger = createLedger();

    expect(ledger.status()).toEqual({
      spentUsd: 0,
      unknownPricing: false,
      liveRecords: 0,
      currentTurn: undefined,
      turns: {},
      goals: {},
    });
  });

  it('excludes session-scoped records from turn and goal breakdowns', async () => {
    const ledger = createLedger();
    await svc.record(agent, 'model-a', a1);

    const status = ledger.status();
    expect(status.spentUsd).toBeCloseTo(0.000028, 9);
    expect(status.liveRecords).toBe(1);
    expect(status.turns).toEqual({});
    expect(status.currentTurn).toBeUndefined();
  });
});
