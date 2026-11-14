import type { Terminal, TUI } from '@hilbras/omnicode-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatalogBrowserApp } from '@/tui/components/dialogs/catalog-browser';
import { AgentActivityViewer } from '@/tui/components/dialogs/agent-activity-viewer';
import {
  LiveAgentsController,
  type LiveAgentsBrowserHost,
  type LiveAgentsBrowserState,
} from '@/tui/controllers/live-agents';
import type { SubagentActivityRecord } from '@/tui/controllers/subagent-activity-store';
import { currentTheme, darkColors } from '#/tui/theme';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (text: string): string => text.replaceAll(ANSI, '');
const ENTER = '\r';

function fakeTerminal(rows: number, columns = 120): Terminal {
  return {
    start: () => {},
    stop: () => {},
    drainInput: () => Promise.resolve(),
    write: () => {},
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: () => {},
    clearFromCursor: () => {},
    clearScreen: () => {},
    setTitle: () => {},
    setProgress: () => {},
  };
}

function fakeUi(): TUI {
  const children: unknown[] = [];
  return {
    children,
    clear: () => {
      children.length = 0;
    },
    addChild: (child: unknown) => {
      children.push(child);
    },
    setFocus: () => {},
    requestRender: () => {},
  } as unknown as TUI;
}

function agentRecord(overrides: Partial<SubagentActivityRecord> = {}): SubagentActivityRecord {
  return {
    agentId: 'agent-1',
    agentName: 'explore',
    description: 'find things',
    parentToolCallId: 'tc-1',
    steps: [],
    totalSteps: 3,
    status: 'running',
    version: 1,
    ...overrides,
  };
}

function makeHost(records: SubagentActivityRecord[]) {
  const browserSlot: { value: LiveAgentsBrowserState | undefined } = { value: undefined };
  const calls: { status: string[]; errors: string[] } = { status: [], errors: [] };
  const host: LiveAgentsBrowserHost = {
    state: {
      terminal: fakeTerminal(24),
      ui: fakeUi(),
      editor: {} as LiveAgentsBrowserHost['state']['editor'],
      get liveAgentsBrowser() {
        return browserSlot.value;
      },
    },
    activityRecords: () => records,
    setLiveAgentsBrowser: (value) => {
      browserSlot.value = value;
    },
    showError: (msg) => {
      calls.errors.push(msg);
    },
    showStatus: (msg) => {
      calls.status.push(msg);
    },
  };
  return { host, browserSlot, calls, records };
}

afterEach(() => {
  currentTheme.setPalette(darkColors);
  vi.restoreAllMocks();
});

describe('LiveAgentsController', () => {
  it('lists every tracked agent with live counters and closes cleanly', () => {
    const records = [
      agentRecord(),
      agentRecord({
        agentId: 'agent-2',
        agentName: 'coder',
        description: undefined,
        status: 'completed',
        totalSteps: 5,
      }),
    ];
    const { host, browserSlot } = makeHost(records);
    const controller = new LiveAgentsController(host);
    controller.show();
    expect(browserSlot.value).not.toBeUndefined();
    const rendered = (browserSlot.value?.component as CatalogBrowserApp)
      .render(100)
      .map(strip)
      .join('\n');
    expect(rendered).toContain('explore › find things');
    expect(rendered).toContain('coder');
    expect(rendered).toContain('3 steps');
    expect(rendered).toContain('5 steps');
    controller.close();
    expect(browserSlot.value).toBeUndefined();
  });

  it('shows a status instead of a panel when no agent was spawned', () => {
    const { host, browserSlot, calls } = makeHost([]);
    const controller = new LiveAgentsController(host);
    controller.show();
    expect(browserSlot.value).toBeUndefined();
    expect(calls.status.join('\n')).toContain('No agent activity');
  });

  it('opens the activity viewer for a running foreground agent and restores the list on close', () => {
    const { host, browserSlot } = makeHost([agentRecord()]);
    const controller = new LiveAgentsController(host);
    controller.show();
    const app = browserSlot.value?.component as CatalogBrowserApp;
    app.handleInput(ENTER);
    app.handleInput(ENTER);
    expect(browserSlot.value?.viewer?.component).toBeInstanceOf(AgentActivityViewer);
    const viewerRender = browserSlot.value?.viewer?.component.render(80).map(strip).join('\n');
    expect(viewerRender).toContain('explore');
    browserSlot.value?.viewer?.component.handleInput('q');
    expect(browserSlot.value?.viewer).toBeUndefined();
    controller.close();
    expect(browserSlot.value).toBeUndefined();
  });

  it('refresh picks up mutated records (status and counters) in list and viewer', () => {
    const records = [agentRecord()];
    const { host, browserSlot } = makeHost(records);
    const controller = new LiveAgentsController(host);
    controller.show();
    const app = browserSlot.value?.component as CatalogBrowserApp;
    app.handleInput(ENTER);
    app.handleInput(ENTER);
    records[0] = agentRecord({
      status: 'failed',
      error: 'spawn failed',
      version: 2,
      totalSteps: 4,
    });
    controller.refresh();
    const viewerRender = browserSlot.value?.viewer?.component.render(100).map(strip).join('\n');
    expect(viewerRender).toContain('explore');
    controller.close();
  });

  it('shows a warning when the selected agent is no longer tracked', () => {
    const { host, browserSlot, calls } = makeHost([]);
    const controller = new LiveAgentsController(host);
    controller.show();
    expect(browserSlot.value).toBeUndefined();
    controller.refresh();
    expect(calls.errors).toEqual([]);
  });
});
