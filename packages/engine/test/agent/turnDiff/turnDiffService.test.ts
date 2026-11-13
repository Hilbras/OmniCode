import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { USER_PROMPT_ORIGIN } from '#/agent/contextMemory/types';
import { TurnEnded } from '#/agent/loop/turnOps';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { makeAgentScopeContext, type IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { AgentTurnDiffService } from '#/agent/turnDiff/turnDiffService';
import { EventBusService } from '#/app/event/eventBusService';
import type { HostFileStat, IHostFileSystem } from '#/os/interface/hostFileSystem';
import type { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import type { RunnableToolExecution, ToolAccesses } from '#/tool/toolContract';
import type { ToolCall } from '#human/llm/message';

import { stubToolExecutorEvents, type ToolExecutorEventStubs } from '../toolExecutor/stubs';

const WORK_DIR = '/ws';

function toolCall(id: string, name: string): ToolCall {
  return { type: 'function', id, name, arguments: '{}' };
}

function execution(accesses: ToolAccesses): RunnableToolExecution {
  return {
    accesses,
    approvalRule: 'test',
    execute: async () => ({ isError: false, output: '' }),
  };
}

class FakeFiles {
  readonly files = new Map<string, string>();
  readonly sizes = new Map<string, number>();

  readonly fs: IHostFileSystem = {
    _serviceBrand: undefined,
    readText: async (path: string) => {
      const content = this.files.get(path);
      if (content === undefined) throw enoent();
      return content;
    },
    writeText: async (path: string, data: string) => {
      this.files.set(path, data);
    },
    appendText: async () => undefined,
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => undefined,
    readLines: async function* () {},
    createExclusive: async () => true,
    stat: async (path: string): Promise<HostFileStat> => {
      const content = this.files.get(path);
      if (content === undefined) throw enoent();
      return {
        isFile: true,
        isDirectory: false,
        size: this.sizes.get(path) ?? Buffer.byteLength(content),
      };
    },
    lstat: async (path: string): Promise<HostFileStat> => this.fs.stat(path),
    readdir: async () => [],
    mkdir: async () => undefined,
    remove: async () => undefined,
    realpath: async (path: string) => path,
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

describe('AgentTurnDiffService', () => {
  let bus: EventBusService;
  let executor: ToolExecutorEventStubs;
  let files: FakeFiles;
  let agent: IAgentScopeContext;
  let service: AgentTurnDiffService;

  beforeEach(() => {
    bus = new EventBusService();
    executor = stubToolExecutorEvents();
    files = new FakeFiles();
    agent = makeAgentScopeContext({ agentId: 'main', agentScope: 'wire' });
    bus.activateAgent(agent.agentContext);
    service = new AgentTurnDiffService(bus, executor.executor, files.fs, workspace, agent);
  });

  afterEach(() => {
    service.dispose();
    bus.dispose();
  });

  function startTurn(turnId: number, target: IAgentScopeContext = agent): void {
    bus.publish(
      new TurnStarted({ agentId: target.agentId, turnId, origin: USER_PROMPT_ORIGIN }),
      target.agentContext,
    );
  }

  function endTurn(turnId: number, target: IAgentScopeContext = agent): void {
    bus.publish(
      new TurnEnded({ agentId: target.agentId, turnId, reason: 'completed' }),
      target.agentContext,
    );
  }

  async function writeTool(
    turnId: number,
    path: string,
    mutate: () => void,
    accesses: ToolAccesses,
  ): Promise<void> {
    await executor.fireWillExecute(
      {
        turnId,
        toolCall: toolCall(`call-${path}`, 'Write'),
        execution: execution(accesses),
        args: {},
      },
      new AbortController().signal,
    );
    mutate();
    await executor.didExecuteSlot.run({
      turnId,
      signal: new AbortController().signal,
      toolCall: toolCall(`call-${path}`, 'Write'),
      toolCalls: [],
      args: {},
      outcome: 'executed',
      accesses,
      result: { isError: false, output: '' },
    });
  }

  it('records added, modified, and deleted files for a turn', async () => {
    files.files.set(`${WORK_DIR}/a.txt`, 'one\n');
    files.files.set(`${WORK_DIR}/c.txt`, 'bye\n');
    startTurn(1);

    await writeTool(1, `${WORK_DIR}/a.txt`, () => files.files.set(`${WORK_DIR}/a.txt`, 'ONE\n'), [
      { kind: 'file', operation: 'readwrite', path: `${WORK_DIR}/a.txt` },
    ]);
    await writeTool(1, `${WORK_DIR}/b.txt`, () => files.files.set(`${WORK_DIR}/b.txt`, 'two\nlines\n'), [
      { kind: 'file', operation: 'write', path: `${WORK_DIR}/b.txt` },
    ]);
    await writeTool(1, `${WORK_DIR}/c.txt`, () => files.files.delete(`${WORK_DIR}/c.txt`), [
      { kind: 'file', operation: 'write', path: `${WORK_DIR}/c.txt` },
    ]);

    endTurn(1);
    await service.settled();
    const snapshot = await service.snapshot(1);
    expect(snapshot).toMatchObject({ turnId: 1, state: 'closed', additions: 3, deletions: 2 });
    expect(snapshot?.files).toEqual([
      { path: 'a.txt', status: 'modified', additions: 1, deletions: 1 },
      { path: 'b.txt', status: 'added', additions: 2, deletions: 0 },
      { path: 'c.txt', status: 'deleted', additions: 0, deletions: 1 },
    ]);
    expect(await service.turns()).toEqual([snapshot]);
  });

  it('exposes a live snapshot through latest while the turn is open', async () => {
    files.files.set(`${WORK_DIR}/a.txt`, 'a\n');
    startTurn(1);
    await writeTool(1, `${WORK_DIR}/a.txt`, () => files.files.set(`${WORK_DIR}/a.txt`, 'b\n'), [
      { kind: 'file', operation: 'write', path: `${WORK_DIR}/a.txt` },
    ]);

    expect(service.activeTurn()).toBe(1);
    const live = await service.latest();
    expect(live).toMatchObject({ turnId: 1, state: 'open', additions: 1, deletions: 1 });
  });

  it('marks a file above the size cap as oversize instead of reading it', async () => {
    files.files.set(`${WORK_DIR}/huge.txt`, 'small');
    files.sizes.set(`${WORK_DIR}/huge.txt`, 2_000_000);
    startTurn(1);
    await writeTool(1, `${WORK_DIR}/huge.txt`, () => undefined, [
      { kind: 'file', operation: 'write', path: `${WORK_DIR}/huge.txt` },
    ]);
    endTurn(1);
    await service.settled();
    expect((await service.snapshot(1))?.files).toEqual([
      { path: 'huge.txt', status: 'modified', additions: 0, deletions: 0, oversize: true },
    ]);
  });

  it('ignores turns from another agent', async () => {
    const other = makeAgentScopeContext({ agentId: 'sub', agentScope: 'wire/sub' });
    bus.activateAgent(other.agentContext);
    files.files.set(`${WORK_DIR}/a.txt`, 'a\n');
    startTurn(2, other);
    endTurn(2, other);
    await service.settled();
    expect(await service.snapshot(2)).toBeUndefined();
  });
});