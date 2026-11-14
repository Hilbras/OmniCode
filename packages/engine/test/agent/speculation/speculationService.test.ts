import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { USER_PROMPT_ORIGIN, type PromptOrigin } from '#/agent/contextMemory/types';
import { stubLoopWithHooks, type StubLoop } from '../loop/stubs';
import { makeAgentScopeContext, type IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import {
  AgentSpeculationService,
} from '#/agent/speculation/speculationService';
import { SpeculationErrors } from '#/agent/speculation/errors';
import { AgentPermissionGate } from '#/agent/permissionGate/permissionGateService';
import type { PermissionPolicyEvaluation } from '#/agent/permissionPolicy/permissionPolicy';
import type { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import type { ToolCallGuard } from '#/agent/toolExecutor/toolExecutor';
import {
  IAgentToolExecutorService,
} from '#/agent/toolExecutor/toolExecutor';
import type {
  BeforeExecuteDecision,
  ResolvedToolExecutionHookContext,
  ToolDidExecuteContext,
} from '#/agent/toolExecutor/toolHooks';
import type { RunnableToolExecution } from '#/tool/toolContract';
import type { HostFileStat, IHostFileSystem } from '#/os/interface/hostFileSystem';
import type { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import { EventBusService } from '#/app/event/eventBusService';
import { TurnEnded } from '#/agent/loop/turnOps';
import { TurnStarted } from '#/agent/loop/turnEvents';
import type { ExecutableToolResult } from '#/tool/toolContract';
import type { ToolCall } from '#human/llm/message';

import { stubPermissionModeService } from '../permissionMode/stubs';
import { stubPermissionPolicyService } from '../permissionPolicy/stubs';
import { stubPermissionRulesService } from '../permissionRules/stubs';
import { stubToolExecutorEvents, type ToolExecutorEventStubs } from '../toolExecutor/stubs';
import { recordingTelemetry, type TelemetryRecord } from '../../app/telemetry/stubs';

const WORK_DIR = '/ws';

interface SpeculationExecutorStubs extends ToolExecutorEventStubs {
  readonly executor: IAgentToolExecutorService;
  readonly guards: ToolCallGuard[];
}

function executorStubs(): SpeculationExecutorStubs {
  const base = stubToolExecutorEvents();
  const guards: ToolCallGuard[] = [];
  const executor: IAgentToolExecutorService = {
    ...base.executor,
    addToolCallGuard: (guard) => {
      guards.push(guard);
      return {
        dispose: () => {
          const index = guards.indexOf(guard);
          if (index >= 0) guards.splice(index, 1);
        },
      };
    },
  };
  return { ...base, executor, guards };
}

class FakeFiles {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];

  readonly fs: IHostFileSystem = {
    _serviceBrand: undefined,
    readText: async (path) => {
      const content = this.files.get(path);
      if (content === undefined) throw enoent();
      return content;
    },
    writeText: async (path, data) => {
      this.writes.push(path);
      this.files.set(path, data);
    },
    appendText: async () => undefined,
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => undefined,
    readLines: async function* () {},
    createExclusive: async () => true,
    stat: async (path): Promise<HostFileStat> => {
      const content = this.files.get(path);
      if (content === undefined) throw enoent();
      return { isFile: true, isDirectory: false, size: Buffer.byteLength(content) };
    },
    lstat: async (path) => this.fs.stat(path),
    readdir: async () => [],
    mkdir: async () => undefined,
    remove: async () => undefined,
    realpath: async (path) => path,
  };
}

function enoent(): Error {
  return Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
}

const workspace: ISessionWorkspaceContext = {
  _serviceBrand: undefined,
  workDir: WORK_DIR,
  additionalDirs: [],
  resolve: (rel: string) => `${WORK_DIR}/${rel}`,
  isWithin: () => true,
  assertAllowed: (absPath: string) => absPath,
};

function toolCall(id: string, name: string, args: unknown): ToolCall {
  return { type: 'function', id, name, arguments: JSON.stringify(args) };
}

function beforeContext(overrides: {
  readonly toolCall: ToolCall;
  readonly args: unknown;
  readonly execution: RunnableToolExecution;
}): ResolvedToolExecutionHookContext {
  return {
    turnId: 1,
    signal: new AbortController().signal,
    toolCall: overrides.toolCall,
    toolCalls: [overrides.toolCall],
    args: overrides.args,
    execution: overrides.execution,
  };
}

function writeExecution(path: string, ran: { readonly value: boolean }): RunnableToolExecution {
  return {
    accesses: [{ kind: 'file', operation: 'write', path }],
    approvalRule: 'Write',
    execute: async () => {
      (ran as { value: boolean }).value = true;
      const result: ExecutableToolResult = { output: 'written' };
      return result;
    },
  };
}

describe('AgentSpeculationService', () => {
  let stubs: SpeculationExecutorStubs;
  let loop: StubLoop;
  let bus: EventBusService;
  let files: FakeFiles;
  let agent: IAgentScopeContext;
  let telemetry: TelemetryRecord[];
  let service: AgentSpeculationService;

  beforeEach(() => {
    stubs = executorStubs();
    loop = stubLoopWithHooks();
    bus = new EventBusService();
    files = new FakeFiles();
    agent = makeAgentScopeContext({ agentId: 'main', agentScope: 'wire' });
    bus.activateAgent(agent.agentContext);
    telemetry = [];
    service = new AgentSpeculationService(
      stubs.executor,
      loop,
      bus,
      files.fs,
      workspace,
      agent,
      recordingTelemetry(telemetry),
    );
  });

  afterEach(() => {
    service.dispose();
    bus.dispose();
  });

  function publishTurn(kind: 'started' | 'ended', turnId: number, origin: PromptOrigin = USER_PROMPT_ORIGIN): void {
    if (kind === 'started') {
      bus.publish(new TurnStarted({ agentId: agent.agentId, turnId, origin }), agent.agentContext);
      return;
    }
    bus.publish(
      new TurnEnded({ agentId: agent.agentId, turnId, reason: 'completed' }),
      agent.agentContext,
    );
  }

  it('arms a preflight guard that refuses risky tools and admits reads', () => {
    service.begin({ origin: 'test' });
    expect(stubs.guards).toHaveLength(1);

    const guard = stubs.guards[0]!;
    expect(guard({ name: 'Bash', source: 'builtin' })).toContain('process-execution');
    expect(guard({ name: 'FetchURL', source: 'builtin' })).toContain('network-egress');
    expect(guard({ name: 'mcp__x__y', source: 'mcp' })).toContain('server-defined-tool');
    expect(guard({ name: 'SomeUnknownTool', source: 'builtin' })).toContain('unknown-tool');
    expect(guard({ name: 'Read', source: 'builtin' })).toBeUndefined();
    expect(guard({ name: 'Write', source: 'builtin' })).toBeUndefined();
  });

  it('refuses a second branch while one is active', () => {
    service.begin({ origin: 'test' });
    let thrown: unknown;
    try {
      service.begin({ origin: 'again' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: SpeculationErrors.codes.SPECULATION_BRANCH_ACTIVE });
  });

  it('refuses risky tools even after a before-execute listener allow()s them', () => {
    service.begin({ origin: 'test' });
    stubs.executor.onBeforeExecuteTool((event) => {
      event.allow();
    });
    const guard = stubs.guards[0]!;
    expect(guard({ name: 'Bash', source: 'builtin' })).not.toBeUndefined();
  });

  it('redirects an approved Write into the overlay instead of executing it', async () => {
    service.begin({ origin: 'test' });
    const ran = { value: false };
    const execution = writeExecution(`${WORK_DIR}/a.txt`, ran);
    const decision = await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution,
      }),
    );

    expect(ran.value).toBe(false);
    expect(decision?.veto).toBeDefined();
    expect(decision?.veto?.output).toContain('Recorded in the speculative branch overlay');
    expect(decision?.veto?.isError).toBeUndefined();
    expect(service.status()?.pendingPaths).toEqual([`${WORK_DIR}/a.txt`]);
  });

  it('never records a write whose approval was denied', async () => {
    stubs.executor.onBeforeExecuteTool((event) => {
      event.waitUntil(async () => ({
        veto: { output: 'User denied permission to run Write.', isError: true } as ExecutableToolResult,
      }));
    });
    service.begin({ origin: 'test' });
    const ran = { value: false };
    const decision = await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution: writeExecution(`${WORK_DIR}/a.txt`, ran),
      }),
    );

    expect(decision?.veto).toMatchObject({ output: 'User denied permission to run Write.' });
    expect(service.status()?.pendingPaths).toEqual([]);
  });

  it('records a write whose approval ask resolved as approved', async () => {
    stubs.executor.onBeforeExecuteTool((event) => {
      event.waitUntil(async () => undefined);
    });
    service.begin({ origin: 'test' });
    const decision = await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution: writeExecution(`${WORK_DIR}/a.txt`, { value: false }),
      }),
    );

    expect(decision?.veto?.output).toContain('Recorded in the speculative branch overlay');
    expect(service.status()?.pendingPaths).toEqual([`${WORK_DIR}/a.txt`]);
  });

  it('refuses a write once the overlay is full, as a synthetic error result', async () => {
    service.begin({ origin: 'test' });
    for (let index = 0; index < 128; index += 1) {
      const path = `file-${String(index)}.txt`;
      const decision = await stubs.fireBeforeExecute(
        beforeContext({
          toolCall: toolCall(`c${String(index)}`, 'Write', { path, content: 'x' }),
          args: { path, content: 'x' },
          execution: writeExecution(`${WORK_DIR}/${path}`, { value: false }),
        }),
      );
      expect(decision?.veto?.isError).toBeUndefined();
    }

    const decision = await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c129', 'Write', { path: 'overflow.txt', content: 'x' }),
        args: { path: 'overflow.txt', content: 'x' },
        execution: writeExecution(`${WORK_DIR}/overflow.txt`, { value: false }),
      }),
    );
    expect(decision?.veto).toMatchObject({ isError: true });
    expect(decision?.veto?.output).toContain('overlay is full');
    expect(service.status()?.pendingPaths).toHaveLength(128);
  });

  it('accept copies the overlay onto the workspace and closes the branch', async () => {
    service.begin({ origin: 'test' });
    await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution: writeExecution(`${WORK_DIR}/a.txt`, { value: false }),
      }),
    );

    const result = await service.accept();
    expect(result).toEqual({ applied: [`${WORK_DIR}/a.txt`] });
    expect(files.files.get(`${WORK_DIR}/a.txt`)).toBe('hello');
    expect(service.status()).toBeUndefined();
    await expect(service.accept()).rejects.toMatchObject({
      code: SpeculationErrors.codes.SPECULATION_NO_BRANCH,
    });
    expect(stubs.guards).toHaveLength(0);
  });

  it('keeps the branch and overlay when an apply fails mid-way', async () => {
    service.begin({ origin: 'test' });
    await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution: writeExecution(`${WORK_DIR}/a.txt`, { value: false }),
      }),
    );
    files.fs.writeText = async () => {
      throw new Error('disk full');
    };

    const result = await service.accept();
    expect(result.failed).toEqual({ path: `${WORK_DIR}/a.txt`, error: 'disk full' });
    expect(service.status()).toMatchObject({ state: 'settled' });
    expect(service.status()?.pendingPaths).toEqual([`${WORK_DIR}/a.txt`]);
  });

  it('discard drops the overlay without writing', async () => {
    service.begin({ origin: 'test' });
    await stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution: writeExecution(`${WORK_DIR}/a.txt`, { value: false }),
      }),
    );

    service.discard();
    expect(service.status()).toBeUndefined();
    expect(files.files.size).toBe(0);
    expect(stubs.guards).toHaveLength(0);
  });

  it('settles the branch when its turn ends and disarms the boundary', () => {
    service.begin({ origin: 'test' });
    publishTurn('started', 7);
    expect(service.status()).toMatchObject({ state: 'live', turnId: 7 });

    publishTurn('ended', 7);
    expect(service.status()).toMatchObject({ state: 'settled' });
    expect(stubs.guards).toHaveLength(0);
  });

  it('launches a forked follow-up turn with the speculation origin and settles at its end', () => {
    const branch = service.launchFollowUp({ prompt: 'finish the goal speculatively' });
    expect(branch.state).toBe('live');
    const handle = loop.promptHandle('p');
    expect(handle?.message.origin).toMatchObject({
      kind: 'system_trigger',
      name: 'speculation_followup',
    });
    expect(handle?.message.content).toEqual([{ type: 'text', text: 'finish the goal speculatively' }]);

    publishTurn('started', 9);
    expect(service.status()).toMatchObject({ turnId: 9, state: 'live' });
    publishTurn('ended', 9);
    expect(service.status()).toMatchObject({ state: 'settled' });
  });

  it('refuses a follow-up while the loop is busy', () => {
    const busyLoop = stubLoopWithHooks();
    busyLoop.startTurn();
    const busy = new AgentSpeculationService(
      stubs.executor,
      busyLoop,
      bus,
      files.fs,
      workspace,
      agent,
      recordingTelemetry(telemetry),
    );
    try {
      let thrown: unknown;
      try {
        busy.launchFollowUp({ prompt: 'work' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: SpeculationErrors.codes.SPECULATION_LOOP_BUSY });
    } finally {
      busy.dispose();
    }
  });

  it('ignores turn events from other agents', () => {
    const subAgent = makeAgentScopeContext({ agentId: 'sub-agent', agentScope: 'wire' });
    bus.activateAgent(subAgent.agentContext);
    service.begin({ origin: 'test' });
    bus.publish(
      new TurnStarted({ agentId: 'sub-agent', turnId: 3, origin: USER_PROMPT_ORIGIN }),
      subAgent.agentContext,
    );
    expect(service.status()?.turnId).toBeUndefined();
  });

  it('reports a synthetic did-execute outcome as non-evidence for the goal capture', async () => {
    service.begin({ origin: 'test' });
    const didContext: ToolDidExecuteContext = {
      turnId: 1,
      signal: new AbortController().signal,
      toolCall: toolCall('c1', 'Write', { path: 'a.txt', content: 'x' }),
      toolCalls: [],
      args: { path: 'a.txt', content: 'x' },
      outcome: 'vetoed',
      result: { output: 'Recorded in the speculative branch overlay' },
    };
    await stubs.didExecuteSlot.run(didContext, async () => undefined);
    expect(didContext.outcome).toBe('vetoed');
  });
});

describe('AgentSpeculationService approval ordering', () => {
  let stubs: SpeculationExecutorStubs;
  let loop: StubLoop;
  let bus: EventBusService;
  let files: FakeFiles;
  let agent: IAgentScopeContext;

  beforeEach(() => {
    stubs = executorStubs();
    loop = stubLoopWithHooks();
    bus = new EventBusService();
    files = new FakeFiles();
    agent = makeAgentScopeContext({ agentId: 'main', agentScope: 'wire' });
    bus.activateAgent(agent.agentContext);
  });

  afterEach(() => {
    bus.dispose();
  });

  /**
   * Composes the REAL permission gate ordering: the gate is constructed first
   * (as at agent-scope creation) and the speculation service second, so the
   * gate's listener and its ask factory are registered ahead of the redirect.
   * If the listener order ever inverts, the redirect factory runs before the
   * gate's ask resolves and the deny assertion below fails with the overlay
   * message instead of the denial.
   */
  function composeGateThenSpeculation(
    policyResult: PermissionPolicyEvaluation | undefined,
    requestToolApproval: IAgentToolApprovalService['requestToolApproval'],
  ): { readonly service: AgentSpeculationService; readonly gate: AgentPermissionGate } {
    const approvals: IAgentToolApprovalService = {
      _serviceBrand: undefined,
      resolvePermissionResolution: async () => undefined,
      requestToolApproval,
      setReviewerLane: () => undefined,
      formatDenyMessage: (message) => message,
      formatApprovalRejectionMessage: () => '',
    };
    const service = new AgentSpeculationService(
      stubs.executor,
      loop,
      bus,
      files.fs,
      workspace,
      agent,
      recordingTelemetry([]),
    );
    const gate = new AgentPermissionGate(
      stubPermissionModeService(() => 'manual'),
      stubPermissionRulesService(() => []),
      stubPermissionPolicyService(() => policyResult),
      approvals,
      recordingTelemetry([]),
      stubs.executor,
    );
    return { service, gate };
  }

  function fireWrite(): Promise<BeforeExecuteDecision | undefined> {
    return stubs.fireBeforeExecute(
      beforeContext({
        toolCall: toolCall('call_write', 'Write', { path: 'a.txt', content: 'hello' }),
        args: { path: 'a.txt', content: 'hello' },
        execution: writeExecution(`${WORK_DIR}/a.txt`, { value: false }),
      }),
    );
  }

  it('never records a write when the real gate ask is denied', async () => {
    const requestToolApproval = vi.fn<IAgentToolApprovalService['requestToolApproval']>(
      async () => ({ veto: { output: 'User denied permission to run Write.', isError: true } }),
    );
    const { service, gate } = composeGateThenSpeculation(
      { policyName: 'fallback-ask', result: { kind: 'ask' } },
      requestToolApproval,
    );
    try {
      service.begin({ origin: 'test' });

      const decision = await fireWrite();

      expect(requestToolApproval).toHaveBeenCalledTimes(1);
      expect(decision?.veto).toMatchObject({ output: 'User denied permission to run Write.' });
      expect(service.status()?.pendingPaths).toEqual([]);
    } finally {
      service.dispose();
      gate.dispose();
    }
  });

  it('records the write when the real gate ask resolves as approved', async () => {
    const requestToolApproval = vi.fn<IAgentToolApprovalService['requestToolApproval']>(
      async () => undefined,
    );
    const { service, gate } = composeGateThenSpeculation(
      { policyName: 'fallback-ask', result: { kind: 'ask' } },
      requestToolApproval,
    );
    try {
      service.begin({ origin: 'test' });

      const decision = await fireWrite();

      expect(requestToolApproval).toHaveBeenCalledTimes(1);
      expect(decision?.veto?.output).toContain('Recorded in the speculative branch overlay');
      expect(service.status()?.pendingPaths).toEqual([`${WORK_DIR}/a.txt`]);
    } finally {
      service.dispose();
      gate.dispose();
    }
  });
});
