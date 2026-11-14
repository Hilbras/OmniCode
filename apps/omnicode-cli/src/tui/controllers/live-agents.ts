/**
 * LiveAgentsController — the `/agents` panel over the in-memory subagent
 * activity store: one entry per child agent this session spawned, foreground
 * or background, with the live step/tool counters and a full-screen activity
 * viewer (the same one the tasks browser opens for background agents).
 *
 * The store tees every child-agent event regardless of the parent card's
 * fate, so a foreground agent detached via Ctrl+B stays watchable here even
 * though it no longer has a transcript card and never appears in the tasks
 * browser's background-task list.
 */

import type { Terminal, TUI } from '@hilbras/omnicode-tui';

import {
  CatalogBrowserApp,
  type CatalogBrowserEntry,
} from '../components/dialogs/catalog-browser';
import { AgentActivityViewer } from '../components/dialogs/agent-activity-viewer';
import type { CustomEditor } from '../components/editor/custom-editor';
import type { ColorToken } from '../theme';
import type {
  SubagentActivityRecord,
} from './subagent-activity-store';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';

const POLL_INTERVAL_MS = 1000;

export interface LiveAgentsBrowserState {
  readonly component: CatalogBrowserApp;
  readonly takeover: ScreenTakeover;
  readonly pollTimer: NodeJS.Timeout | undefined;
  viewer:
    | {
        readonly component: AgentActivityViewer;
        readonly takeover: ScreenTakeover;
        readonly agentId: string;
      }
    | undefined;
}

export interface LiveAgentsBrowserHost {
  readonly state: {
    readonly terminal: Terminal;
    readonly ui: TUI;
    readonly editor: CustomEditor;
    readonly liveAgentsBrowser: LiveAgentsBrowserState | undefined;
  };
  readonly activityRecords: () => readonly SubagentActivityRecord[];
  setLiveAgentsBrowser(value: LiveAgentsBrowserState | undefined): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
}

function toolCountOf(record: SubagentActivityRecord): number {
  return record.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
}

function recordEntry(record: SubagentActivityRecord): CatalogBrowserEntry {
  const label =
    record.description !== undefined && record.description.length > 0
      ? `${record.agentName} › ${record.description}`
      : record.agentName;
  return {
    id: record.agentId,
    name: label,
    status: record.status,
    statusTone: record.status === 'failed' ? 'error' : record.status === 'running' ? 'ok' : 'muted',
    badges: [
      `${String(record.totalSteps)} step${record.totalSteps === 1 ? '' : 's'}`,
      `${String(toolCountOf(record))} tool${toolCountOf(record) === 1 ? '' : 's'}`,
    ],
    actions: [
      {
        id: 'view',
        label: 'View live activity',
        description: 'Open the full-screen agent activity viewer',
      },
    ],
  };
}

export class LiveAgentsController {
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(private readonly host: LiveAgentsBrowserHost) {}

  show(): void {
    const { state } = this.host;
    if (state.liveAgentsBrowser !== undefined) return;
    const records = this.host.activityRecords();
    if (records.length === 0) {
      this.host.showStatus('No agent activity recorded yet this session.');
      return;
    }
    const component = new CatalogBrowserApp(
      {
        title: ' Live agents ',
        entries: records.map(recordEntry),
        error: undefined,
        emptyMessage: 'No agents spawned yet.',
        onCancel: () => {
          this.close();
        },
        onAction: (entry) => {
          this.openViewer(entry.id);
        },
        onRefresh: () => {
          this.refresh();
        },
        searchable: true,
      },
      state.terminal,
    );
    const takeover = beginScreenTakeover(state.ui, component);
    state.ui.setFocus(component);
    state.ui.requestRender(true);
    this.pollTimer = setInterval(() => {
      this.refresh();
    }, POLL_INTERVAL_MS);
    this.host.setLiveAgentsBrowser({ component, takeover, pollTimer: this.pollTimer, viewer: undefined });
  }

  close(): void {
    const { state } = this.host;
    const browser = state.liveAgentsBrowser;
    if (browser === undefined) return;
    if (browser.viewer !== undefined) this.closeViewer();
    this.stopPollTimer();
    endScreenTakeover(state.ui, browser.takeover);
    this.host.setLiveAgentsBrowser(undefined);
    state.ui.setFocus(state.editor);
    state.ui.requestRender(true);
  }

  refresh(): void {
    const browser = this.host.state.liveAgentsBrowser;
    if (browser === undefined) return;
    const records = this.host.activityRecords();
    browser.component.setProps({
      title: ' Live agents ',
      entries: records.map(recordEntry),
      error: undefined,
      emptyMessage: 'No agents spawned yet.',
      onCancel: () => {
        this.close();
      },
      onAction: (entry) => {
        this.openViewer(entry.id);
      },
      onRefresh: () => {
        this.refresh();
      },
      searchable: true,
    });
    if (browser.viewer !== undefined) {
      const record = records.find((candidate) => candidate.agentId === browser.viewer?.agentId);
      browser.viewer.component.setProps({
        taskId: browser.viewer.agentId,
        info: undefined,
        record,
        onClose: () => {
          this.closeViewer();
        },
      });
    }
    this.host.state.ui.requestRender();
  }

  private openViewer(agentId: string | undefined): void {
    const browser = this.host.state.liveAgentsBrowser;
    if (browser === undefined || browser.viewer !== undefined || agentId === undefined) return;
    const record = this.host.activityRecords().find((candidate) => candidate.agentId === agentId);
    if (record === undefined) {
      this.host.showStatus('That agent is no longer being tracked.', 'warning');
      return;
    }
    const viewer = new AgentActivityViewer(
      {
        taskId: agentId,
        info: undefined,
        record,
        onClose: () => {
          this.closeViewer();
        },
      },
      this.host.state.terminal,
    );
    const takeover = beginScreenTakeover(this.host.state.ui, viewer);
    this.host.state.ui.setFocus(viewer);
    this.host.state.ui.requestRender(true);
    browser.viewer = { component: viewer, takeover, agentId };
  }

  private closeViewer(): void {
    const browser = this.host.state.liveAgentsBrowser;
    const viewer = browser?.viewer;
    if (browser === undefined || viewer === undefined) return;
    endScreenTakeover(this.host.state.ui, viewer.takeover);
    browser.viewer = undefined;
    this.host.state.ui.setFocus(browser.component);
    this.host.state.ui.requestRender(true);
  }

  private stopPollTimer(): void {
    if (this.pollTimer === undefined) return;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}
