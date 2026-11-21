import type { AppTerminal } from '@hilbras/app-core/api';
import { describe, expect, it, vi } from 'vitest';

import { SessionTerminalBridge } from '../src/api/terminalBridge';

function makeApi() {
  const created: AppTerminal[] = [];
  const closed: string[] = [];
  let outputSink: ((sessionId: string, terminalId: string, data: string) => void) | undefined;
  let exitSink: ((sessionId: string, terminalId: string, exitCode: number | null) => void) | undefined;
  let terminalSeq = 0;
  const api = {
    listTerminals: vi.fn(async () => [...created]),
    createTerminal: vi.fn(async (_sessionId: string, input?: { cols?: number; rows?: number }) => {
      terminalSeq += 1;
      const terminal: AppTerminal = {
        id: `term-${String(terminalSeq)}`,
        sessionId: 's1',
        cwd: '/tmp',
        shell: '/bin/bash',
        cols: input?.cols ?? 80,
        rows: input?.rows ?? 24,
        status: 'running',
        createdAt: new Date().toISOString(),
      };
      created.push(terminal);
      return terminal;
    }),
    getTerminal: vi.fn(),
    closeTerminal: vi.fn(async (_sessionId: string, terminalId: string) => {
      closed.push(terminalId);
      return { closed: true as const };
    }),
    connectEvents: vi.fn((handlers: {
      onTerminalOutput?: (sessionId: string, terminalId: string, data: string) => void;
      onTerminalExit?: (sessionId: string, terminalId: string, exitCode: number | null) => void;
    }) => {
      outputSink = handlers.onTerminalOutput;
      exitSink = handlers.onTerminalExit;
      return {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        subscribeTranscript: vi.fn(),
        unsubscribeTranscript: vi.fn(),
        bindNextPromptId: vi.fn(),
        abort: vi.fn(),
        terminalAttach: vi.fn(),
        terminalInput: vi.fn(),
        terminalResize: vi.fn(),
        terminalDetach: vi.fn(),
        terminalClose: vi.fn(),
        markSideChannelAgent: vi.fn(),
        health: () => ({ connected: true, open: true, stale: false }),
        reconnect: vi.fn(),
        close: vi.fn(),
      };
    }),
  };
  return {
    api: api as unknown as import('@hilbras/app-core/api').OmnicodeWebApi,
    created,
    closed,
    emitOutput: (terminalId: string, data: string, sessionId = 's1') =>
      outputSink?.(sessionId, terminalId, data),
    emitExit: (terminalId: string, code: number | null) => exitSink?.('s1', terminalId, code),
    connectionOf: () => {
      // the last connectEvents call's returned connection is captured inside vi.fn
      const calls = (api.connectEvents as ReturnType<typeof vi.fn>).mock.results;
      return calls[calls.length - 1]?.value as {
        terminalAttach: ReturnType<typeof vi.fn>;
        terminalInput: ReturnType<typeof vi.fn>;
        terminalResize: ReturnType<typeof vi.fn>;
        terminalClose: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
    },
  };
}

describe('SessionTerminalBridge', () => {
  it('creates a terminal, attaches it, and forwards output frames', async () => {
    const harness = makeApi();
    const bridge = new SessionTerminalBridge(harness.api, 's1');
    const outputs: string[] = [];
    bridge.onOutput((_id, data) => outputs.push(data));

    const terminal = await bridge.create({ cols: 100, rows: 30 });

    const connection = harness.connectionOf();
    expect(connection.terminalAttach).toHaveBeenCalledWith('s1', terminal.id);

    harness.emitOutput(terminal.id, 'hello\r\n');
    expect(outputs).toEqual(['hello\r\n']);

    bridge.write(terminal.id, 'ls\r');
    expect(connection.terminalInput).toHaveBeenCalledWith('s1', terminal.id, 'ls\r');

    bridge.resize(terminal.id, 120, 40);
    expect(connection.terminalResize).toHaveBeenCalledWith('s1', terminal.id, 120, 40);
  });

  it('ignores output frames from other sessions', async () => {
    const harness = makeApi();
    const bridge = new SessionTerminalBridge(harness.api, 's1');
    const outputs: string[] = [];
    bridge.onOutput((_id, data) => outputs.push(data));

    await bridge.create();
    harness.emitOutput('term-1', 'foreign', 'other-session');
    expect(outputs).toEqual([]);
  });

  it('routes exit frames and closes through the daemon', async () => {
    const harness = makeApi();
    const bridge = new SessionTerminalBridge(harness.api, 's1');
    const exits: Array<number | null> = [];
    bridge.onExit((_id, code) => exits.push(code));

    const terminal = await bridge.create();
    await bridge.close(terminal.id);

    expect(harness.closed).toEqual([terminal.id]);
    expect(harness.connectionOf().terminalClose).toHaveBeenCalledWith('s1', terminal.id);

    harness.emitExit(terminal.id, 0);
    expect(exits).toEqual([0]);
  });

  it('dispose closes the connection and stops delivery', async () => {
    const harness = makeApi();
    const bridge = new SessionTerminalBridge(harness.api, 's1');
    const outputs: string[] = [];
    bridge.onOutput((_id, data) => outputs.push(data));

    await bridge.create();
    bridge.dispose();
    expect(harness.connectionOf().close).toHaveBeenCalled();

    harness.emitOutput('term-1', 'after-dispose');
    expect(outputs).toEqual([]);
  });
});
