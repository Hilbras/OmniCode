/**
 * ToolCallsController — the `/tools` palette over the transcript's tool-call
 * cards with per-card actions: show full output, open diff, copy path, jump
 * to the artifact, and retry (re-send the last user prompt).
 *
 * Cards are read from the rendered transcript entries (same source `/copy`
 * uses), so the palette works mid-turn, after compaction, and on resume
 * without any engine round-trip. Retry semantics: the engine has no per-tool
 * re-run API, so the honest retry available to the UI is re-sending the
 * prompt that produced the work.
 */

import { isAbsolute, relative, sep } from 'node:path';

import type { Terminal, TUI } from '@hilbras/omnicode-tui';

import { renderDiffLinesClustered } from '../components/media/diff-preview';
import {
  CatalogBrowserApp,
  type CatalogBrowserAction,
  type CatalogBrowserEntry,
} from '../components/dialogs/catalog-browser';
import { ToolOutputViewer } from '../components/dialogs/tool-output-viewer';
import { UsagePanelComponent } from '../components/messages/usage-panel';
import { extractKeyArgument } from '../components/messages/tool-call';
import { isSpilledToolOutput } from '../components/messages/tool-renderers/types';
import type { ColorToken } from '../theme';
import type { AppState, ToolCallBlockData, TranscriptEntry } from '../types';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';
import { copyTextToClipboard } from '../../utils/clipboard/clipboard-text';
import { openUrl } from '../../utils/open-url';
import type { CustomEditor } from '../components/editor/custom-editor';

const PREVIEW_MAX_CHARS = 80;
const PATH_ARG_KEYS = new Set(['path', 'file_path']);

export interface ToolCardDiff {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
}

export interface ToolCallCard {
  /** Transcript entry id — stable identity for the palette entry. */
  readonly id: string;
  readonly name: string;
  /** Key argument as shown on the card header (already width-capped). */
  readonly keyArgument: string | null;
  readonly isError: boolean;
  readonly hasResult: boolean;
  readonly path: string | undefined;
  readonly diff: ToolCardDiff | undefined;
  readonly output: string | undefined;
}

export interface ToolCallsBrowserState {
  readonly component: CatalogBrowserApp;
  readonly takeover: ScreenTakeover;
  viewer:
    | {
        readonly component: ToolOutputViewer;
        readonly takeover: ScreenTakeover;
        readonly cardId: string;
      }
    | undefined;
}

export interface ToolCallsBrowserHost {
  readonly state: {
    readonly terminal: Terminal;
    readonly ui: TUI;
    readonly editor: CustomEditor;
    readonly toolCallsBrowser: ToolCallsBrowserState | undefined;
    readonly transcriptEntries: readonly TranscriptEntry[];
    readonly appState: Pick<AppState, 'workDir' | 'isCompacting' | 'streamingPhase'>;
  };
  setToolCallsBrowser(value: ToolCallsBrowserState | undefined): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  /** Re-sends the prompt text through the normal submission path. */
  retryLastPrompt(text: string): void;
  /** Adds a diff panel to the transcript (the controller closes itself first). */
  showCardDiffPanel(lines: readonly string[]): void;
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function previewLine(output: string): string {
  for (const line of output.split('\n')) {
    const trimmed = singleLine(line);
    if (trimmed.length > 0) {
      return trimmed.length > PREVIEW_MAX_CHARS ? `${trimmed.slice(0, PREVIEW_MAX_CHARS)}…` : trimmed;
    }
  }
  return '';
}

function makeWorkspaceRelative(filePath: string, workspaceDir: string | undefined): string {
  if (workspaceDir === undefined || workspaceDir.length === 0 || !isAbsolute(filePath)) {
    return filePath;
  }
  const rel = relative(workspaceDir, filePath);
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return filePath;
  }
  return rel;
}

function stringArg(call: ToolCallBlockData, key: string): string {
  const value = call.args[key];
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function pathArg(call: ToolCallBlockData): string | undefined {
  for (const key of PATH_ARG_KEYS) {
    const value = stringArg(call, key);
    if (value.length > 0) return value;
  }
  return undefined;
}

const SPILL_OUTPUT_PATH_RE = /^output_path: (.+)$/m;

/**
 * The saved-output path of a spilled result. Only spill envelopes carry an
 * `output_path:` line — an ordinary result that merely contains that text is
 * not treated as a file pointer.
 */
export function extractSpillOutputPath(output: string): string | undefined {
  if (!isSpilledToolOutput(output)) return undefined;
  const match = SPILL_OUTPUT_PATH_RE.exec(output);
  const path = match?.[1]?.trim();
  return path !== undefined && path.length > 0 ? path : undefined;
}

export function toolCardPath(call: ToolCallBlockData, output: string | undefined): string | undefined {
  const fromArgs = pathArg(call);
  if (fromArgs !== undefined) return fromArgs;
  return output === undefined ? undefined : extractSpillOutputPath(output);
}

/**
 * The card's own diff payload: Edit pairs old/new strings, Write is a
 * whole-file addition against an empty base. Other tools have no args-level
 * diff — `undefined` disables the action.
 */
export function toolCardDiff(call: ToolCallBlockData): ToolCardDiff | undefined {
  const filePath = pathArg(call);
  if (filePath === undefined) return undefined;
  switch (call.name) {
    case 'Edit': {
      const oldText = stringArg(call, 'old_string');
      const newText = stringArg(call, 'new_string');
      if (oldText.length === 0 && newText.length === 0) return undefined;
      return { path: filePath, oldText, newText };
    }
    case 'Write': {
      const content = stringArg(call, 'content');
      if (content.length === 0) return undefined;
      return { path: filePath, oldText: '', newText: content };
    }
    default:
      return undefined;
  }
}

/** Newest-first cards from the transcript entries that carry tool-call data. */
export function collectToolCallCards(
  entries: readonly TranscriptEntry[],
  workspaceDir: string | undefined,
): ToolCallCard[] {
  const cards: ToolCallCard[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const call = entry?.toolCallData;
    if (entry === undefined || call === undefined) continue;
    const output = call.result?.output;
    const result = call.result;
    cards.push({
      id: entry.id,
      name: call.name,
      keyArgument: extractKeyArgument(call.name, call.args, workspaceDir),
      isError: result?.is_error === true,
      hasResult: result !== undefined,
      path: toolCardPath(call, output),
      diff: toolCardDiff(call),
      output,
    });
  }
  return cards;
}

/**
 * The last real user prompt: shell-command echoes are recorded with a
 * `bullet` override (empty string, `$ ` prefix in the content), so only
 * entries carrying no `bullet` override — the default prompt bullet — are
 * retryable.
 */
export function findLastUserPrompt(entries: readonly TranscriptEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.kind !== 'user') continue;
    if (entry.bullet !== undefined) continue;
    const text = entry.content.trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

/** Panel body for one card's diff: header, full clustered render, no caps. */
export function cardDiffLines(
  card: ToolCallCard,
  workspaceDir: string | undefined,
): readonly string[] {
  const diff = card.diff;
  if (diff === undefined) return [];
  const lines: string[] = [singleLine(`Card diff · ${makeWorkspaceRelative(diff.path, workspaceDir)}`)];
  lines.push(...renderDiffLinesClustered(diff.oldText, diff.newText, diff.path));
  return lines;
}

export class ToolCallsController {
  private cards: ToolCallCard[] = [];

  constructor(private readonly host: ToolCallsBrowserHost) {}

  show(): void {
    const { state } = this.host;
    if (state.toolCallsBrowser !== undefined) return;
    this.cards = collectToolCallCards(state.transcriptEntries, state.appState.workDir);
    if (this.cards.length === 0) {
      this.host.showStatus('No tool calls in this session yet.');
      return;
    }
    const component = new CatalogBrowserApp(
      {
        title: ' Tool calls ',
        entries: this.buildEntries(),
        error: undefined,
        emptyMessage: 'No tool calls yet.',
        onCancel: () => {
          this.close();
        },
        onAction: (entry, action) => {
          this.runAction(entry.id, action);
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
    this.host.setToolCallsBrowser({ component, takeover, viewer: undefined });
  }

  close(): void {
    const { state } = this.host;
    const browser = state.toolCallsBrowser;
    if (browser === undefined) return;
    if (browser.viewer !== undefined) this.closeOutputViewer();
    endScreenTakeover(state.ui, browser.takeover);
    this.host.setToolCallsBrowser(undefined);
    state.ui.setFocus(state.editor);
    state.ui.requestRender(true);
  }

  refresh(): void {
    const browser = this.host.state.toolCallsBrowser;
    if (browser === undefined) return;
    this.cards = collectToolCallCards(
      this.host.state.transcriptEntries,
      this.host.state.appState.workDir,
    );
    browser.component.setProps({
      title: ' Tool calls ',
      entries: this.buildEntries(),
      error: undefined,
      emptyMessage: 'No tool calls yet.',
      onCancel: () => {
        this.close();
      },
      onAction: (entry, action) => {
        this.runAction(entry.id, action);
      },
      onRefresh: () => {
        this.refresh();
      },
      searchable: true,
    });
    this.host.state.ui.requestRender();
  }

  private buildEntries(): readonly CatalogBrowserEntry[] {
    const workspaceDir = this.host.state.appState.workDir;
    const lastPrompt = findLastUserPrompt(this.host.state.transcriptEntries);
    return this.cards.map((card) => {
      let detail: string | undefined;
      if (card.hasResult) {
        const preview = previewLine(card.output ?? '');
        detail = preview.length > 0 ? preview : undefined;
      } else {
        detail = 'still running';
      }
      const entry: CatalogBrowserEntry = {
        id: card.id,
        name: card.keyArgument === null ? card.name : `${card.name}  ${card.keyArgument}`,
        detail,
        status: card.hasResult ? (card.isError ? 'failed' : 'done') : 'running',
        statusTone: card.hasResult ? (card.isError ? 'error' : 'ok') : 'muted',
        actions: this.buildActions(card, lastPrompt),
      };
      if (card.path !== undefined) {
        return { ...entry, badges: [makeWorkspaceRelative(card.path, workspaceDir)] };
      }
      return entry;
    });
  }

  private buildActions(
    card: ToolCallCard,
    lastPrompt: string | undefined,
  ): readonly CatalogBrowserAction[] {
    const retryDisabled = lastPrompt === undefined || this.isTurnInFlight();
    const actions: CatalogBrowserAction[] = [
      {
        id: 'output',
        label: 'Show full output',
        description: 'Open the result output in a full-screen viewer',
        disabled: !card.hasResult || (card.output?.length ?? 0) === 0,
      },
      {
        id: 'diff',
        label: 'Open diff',
        description: 'Render this card’s file change as a diff panel',
        disabled: card.diff === undefined,
      },
      {
        id: 'copy-path',
        label: 'Copy path',
        description: 'Copy the file path this card touched to the clipboard',
        disabled: card.path === undefined,
      },
      {
        id: 'open',
        label: 'Jump to artifact',
        description: 'Open the file with the system opener',
        disabled: card.path === undefined,
      },
      {
        id: 'retry',
        label: 'Retry turn',
        description: 'Re-send the last user prompt (the engine has no per-tool re-run)',
        disabled: retryDisabled,
        tone: 'danger',
        confirm:
          lastPrompt === undefined
            ? undefined
            : 'Re-send the last user prompt as a new turn?',
      },
    ];
    return actions;
  }

  private isTurnInFlight(): boolean {
    const { appState } = this.host.state;
    return appState.streamingPhase !== 'idle' || appState.isCompacting;
  }

  private runAction(cardId: string | undefined, action: CatalogBrowserAction): void {
    if (cardId === undefined) return;
    const card = this.cards.find((candidate) => candidate.id === cardId);
    if (card === undefined) return;
    switch (action.id) {
      case 'output':
        this.openOutput(card);
        return;
      case 'diff':
        this.openDiff(card);
        return;
      case 'copy-path':
        void this.copyPath(card);
        return;
      case 'open':
        this.openArtifact(card);
        return;
      case 'retry':
        this.retryTurn();
        return;
      default:
        return;
    }
  }

  private openOutput(card: ToolCallCard): void {
    const current = this.host.state.toolCallsBrowser;
    if (current === undefined || current.viewer !== undefined) return;
    if (card.output === undefined || card.output.length === 0) return;
    const viewer = new ToolOutputViewer(
      {
        toolName: card.name,
        headerDetail: card.keyArgument ?? undefined,
        isError: card.isError,
        output: card.output,
        onClose: () => {
          this.closeOutputViewer();
        },
      },
      this.host.state.terminal,
    );
    const takeover = beginScreenTakeover(this.host.state.ui, viewer);
    this.host.state.ui.setFocus(viewer);
    this.host.state.ui.requestRender(true);
    current.viewer = { component: viewer, takeover, cardId: card.id };
  }

  private closeOutputViewer(): void {
    const browser = this.host.state.toolCallsBrowser;
    const viewer = browser?.viewer;
    if (browser === undefined || viewer === undefined) return;
    endScreenTakeover(this.host.state.ui, viewer.takeover);
    browser.viewer = undefined;
    this.host.state.ui.setFocus(browser.component);
    this.host.state.ui.requestRender(true);
  }

  private openDiff(card: ToolCallCard): void {
    if (card.diff === undefined) return;
    const lines = cardDiffLines(card, this.host.state.appState.workDir);
    this.close();
    this.host.showCardDiffPanel(lines);
  }

  private async copyPath(card: ToolCallCard): Promise<void> {
    const path = card.path;
    if (path === undefined) return;
    try {
      const method = await copyTextToClipboard(path);
      this.host.showStatus(
        method === 'native'
          ? `Copied ${path}`
          : `Copied via terminal escape sequence (unverified): ${path}`,
      );
    } catch (error) {
      this.host.showError(
        `Failed to copy to clipboard: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private openArtifact(card: ToolCallCard): void {
    const path = card.path;
    if (path === undefined) return;
    openUrl(path, (error) => {
      this.host.showStatus(`Could not open ${path}: ${error.message}`, 'warning');
    });
  }

  private retryTurn(): void {
    if (this.isTurnInFlight()) {
      this.host.showStatus('A turn is still running — press Esc or Ctrl-C first.', 'warning');
      return;
    }
    const lastPrompt = findLastUserPrompt(this.host.state.transcriptEntries);
    if (lastPrompt === undefined) {
      this.host.showStatus('No user prompt to retry.', 'warning');
      return;
    }
    this.close();
    this.host.retryLastPrompt(lastPrompt);
  }
}
