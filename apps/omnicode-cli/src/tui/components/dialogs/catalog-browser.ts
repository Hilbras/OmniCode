/**
 * CatalogBrowserApp — full-screen takeover listing a catalog.
 *
 * Presentation only: the controller feeds entries in through `setProps` and
 * owns the screen takeover; this component never talks to the SDK.
 *
 * Connectors use the card variant. Enter opens a dedicated detail page for the
 * selected connector; actions run from that page.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
  type Terminal,
} from '@hilbras/omnicode-tui';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';

/** Minimum dimensions before the page degrades to a "too small" notice. */
const MIN_WIDTH = 24;
const MIN_HEIGHT = 8;

export type CatalogStatusTone = 'ok' | 'warn' | 'error' | 'muted';

export interface CatalogBrowserAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly tone?: 'default' | 'danger';
  /** Inline confirmation text; `y` runs the action, `n`/Esc cancels. */
  readonly confirm?: string;
}

export interface CatalogBrowserEntry {
  /** Stable identity of the entry, when the catalog has one. */
  readonly id?: string;
  readonly name: string;
  /** Secondary line under the name (description / when-to-use hint). */
  readonly detail?: string;
  /** Group header shown above the first entry of each group. */
  readonly group?: string;
  /** Short status badge, e.g. active / needs trust. */
  readonly status?: string;
  readonly statusTone?: CatalogStatusTone;
  /** Additional compact badges, e.g. scope / kind. */
  readonly badges?: readonly string[];
  /** Capabilities shown on the detail page. */
  readonly capabilities?: readonly string[];
  /** Setup hint shown on the detail page. */
  readonly setupHint?: string;
  /** Actions offered on the detail page. */
  readonly actions?: readonly CatalogBrowserAction[];
}

export interface CatalogBrowserProps {
  readonly title: string;
  readonly entries: readonly CatalogBrowserEntry[];
  /** Load failure message; replaces the list when set. */
  readonly error: string | undefined;
  /** Message shown when the catalog holds no entries. */
  readonly emptyMessage: string;
  /** Progress or outcome message shown above the list. */
  readonly status?: string;
  readonly onCancel: () => void;
  /** Confirmation handler for a read-only catalog. */
  readonly onSelect?: (entry: CatalogBrowserEntry) => void;
  /** Action handler for a catalog with actions. */
  readonly onAction?: (entry: CatalogBrowserEntry, action: CatalogBrowserAction) => void;
  /** Refresh handler; enables the `r` shortcut. */
  readonly onRefresh?: () => void;
  /** Enable `/` search. */
  readonly searchable?: boolean;
  /** Presentation: compact list (default) or card list. */
  readonly variant?: 'list' | 'cards';
}

interface DisplayRow {
  readonly text: string;
  readonly entryIndex?: number;
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function toneColor(tone: CatalogStatusTone | undefined): 'success' | 'warning' | 'error' | 'textMuted' {
  switch (tone) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'textMuted';
  }
}

export class CatalogBrowserApp extends Container implements Focusable {
  focused = false;

  private props: CatalogBrowserProps;
  private readonly terminal: Terminal;
  private selectedIndex = 0;
  private scroll = 0;
  private searchMode = false;
  private searchQuery = '';
  private detailEntry: CatalogBrowserEntry | undefined;
  private actionIndex = 0;
  private confirmEntry: CatalogBrowserEntry | undefined;
  private confirmAction: CatalogBrowserAction | undefined;

  constructor(props: CatalogBrowserProps, terminal: Terminal) {
    super();
    this.props = props;
    this.terminal = terminal;
  }

  setProps(props: CatalogBrowserProps): void {
    const detailId = this.detailEntry?.id;
    this.props = props;
    if (detailId !== undefined) {
      const updated = props.entries.find((entry) => entry.id === detailId);
      this.detailEntry = updated;
      if (updated === undefined) this.actionIndex = 0;
      else this.actionIndex = Math.min(this.actionIndex, Math.max(0, (updated.actions?.length ?? 0) - 1));
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredEntries().length - 1));
    this.confirmEntry = undefined;
    this.confirmAction = undefined;
    this.invalidate();
  }

  handleInput(data: string): void {
    if (this.confirmAction !== undefined) {
      this.handleConfirmInput(data);
      return;
    }
    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }
    if (this.detailEntry !== undefined) {
      this.handleDetailInput(data);
      return;
    }

    const key = printableChar(data);
    if (matchesKey(data, Key.escape) || key === 'q' || key === 'Q') {
      this.props.onCancel();
      return;
    }
    if (this.props.searchable === true && key === '/') {
      this.searchMode = true;
      this.invalidate();
      return;
    }
    if (key === 'r' && this.props.onRefresh !== undefined) {
      this.props.onRefresh();
      return;
    }

    const entries = this.filteredEntries();
    if (entries.length === 0) return;

    if (matchesKey(data, Key.up) || key === 'k') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || key === 'j') {
      this.selectedIndex = Math.min(entries.length - 1, this.selectedIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const entry = entries[this.selectedIndex];
      if (entry === undefined) return;
      if (entry.actions !== undefined && entry.actions.length > 0 && this.props.onAction !== undefined) {
        this.detailEntry = entry;
        this.actionIndex = 0;
        this.scroll = 0;
        this.searchMode = false;
        this.searchQuery = '';
        this.invalidate();
        return;
      }
      this.props.onSelect?.(entry);
    }
  }

  override render(width: number): string[] {
    const rows = Math.max(1, this.terminal.rows);
    if (width < MIN_WIDTH || rows < MIN_HEIGHT) return this.renderTooSmall(width, rows);
    if (this.detailEntry !== undefined) return this.renderDetail(width, rows);
    return this.renderList(width, rows);
  }

  private handleConfirmInput(data: string): void {
    const key = printableChar(data);
    if (key === 'y' || key === 'Y') {
      const entry = this.confirmEntry;
      const action = this.confirmAction;
      this.confirmEntry = undefined;
      this.confirmAction = undefined;
      if (entry !== undefined && action !== undefined) this.props.onAction?.(entry, action);
      this.invalidate();
      return;
    }
    if (key === 'n' || key === 'N' || matchesKey(data, Key.escape)) {
      this.confirmEntry = undefined;
      this.confirmAction = undefined;
      this.invalidate();
    }
  }

  private handleSearchInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.searchQuery.length > 0) this.searchQuery = '';
      else this.searchMode = false;
      this.selectedIndex = 0;
      this.scroll = 0;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.searchMode = false;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.selectedIndex = 0;
      this.scroll = 0;
      this.invalidate();
      return;
    }
    const key = printableChar(data);
    if (key.length > 0) {
      this.searchQuery += key;
      this.selectedIndex = 0;
      this.scroll = 0;
      this.invalidate();
    }
  }

  private handleDetailInput(data: string): void {
    const entry = this.detailEntry;
    if (entry === undefined) return;
    const actions = entry.actions ?? [];
    const key = printableChar(data);
    if (matchesKey(data, Key.escape) || key === 'q' || key === 'Q') {
      this.detailEntry = undefined;
      this.actionIndex = 0;
      this.scroll = 0;
      this.invalidate();
      return;
    }
    if (key === 'r' && this.props.onRefresh !== undefined) {
      this.props.onRefresh();
      return;
    }
    if (matchesKey(data, Key.up) || key === 'k') {
      this.actionIndex = Math.max(0, this.actionIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || key === 'j') {
      this.actionIndex = Math.min(actions.length - 1, this.actionIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const action = actions[this.actionIndex];
      if (action === undefined || action.disabled === true) return;
      if (action.confirm !== undefined) {
        this.confirmEntry = entry;
        this.confirmAction = action;
        this.invalidate();
        return;
      }
      this.props.onAction?.(entry, action);
    }
  }

  private renderList(width: number, rows: number): string[] {
    const statusLines = this.props.status === undefined ? [] : this.props.status.split('\n');
    const headerHeight = 4 + statusLines.length;
    const listHeight = Math.max(1, rows - headerHeight - 3);
    const border = currentTheme.fg('primary', '─'.repeat(width));
    const entries = this.filteredEntries();
    const count =
      entries.length > 0 ? currentTheme.fg('textMuted', ` (${String(entries.length)})`) : '';

    const lines: string[] = [
      border,
      currentTheme.boldFg('primary', ` ${this.props.title}`) + count,
      this.hintLine(),
    ];
    for (const line of statusLines) lines.push(currentTheme.fg('text', ` ${line}`));
    lines.push('');

    if (this.props.error !== undefined) {
      lines.push(currentTheme.fg('error', ` ${singleLine(this.props.error)}`));
      while (lines.length < rows - 1) lines.push('');
      lines.push(border);
      return lines.slice(0, rows).map((line) => truncateToWidth(line, width));
    }

    if (entries.length === 0) {
      for (const line of this.props.emptyMessage.split('\n')) {
        lines.push(currentTheme.fg('textMuted', ` ${line}`));
      }
      while (lines.length < rows - 1) lines.push('');
      lines.push(border);
      return lines.slice(0, rows).map((line) => truncateToWidth(line, width));
    }

    const { rows: displayRows, starts } = this.buildDisplayRows(entries, width);
    this.adjustScroll(starts, displayRows.length, listHeight);
    const visible = displayRows.slice(this.scroll, this.scroll + listHeight);
    for (const row of visible) lines.push(row.text);
    while (lines.length < headerHeight + listHeight) lines.push('');
    lines.push('');
    const more = displayRows.length - (this.scroll + listHeight);
    lines.push(more > 0 ? currentTheme.fg('textMuted', ` ▼ ${String(more)} more`) : '');
    while (lines.length < rows - 1) lines.push('');
    lines.push(border);
    return lines.slice(0, rows).map((line) => truncateToWidth(line, width));
  }

  private renderDetail(width: number, rows: number): string[] {
    const entry = this.detailEntry!;
    const statusLines = this.props.status === undefined ? [] : this.props.status.split('\n');
    const border = currentTheme.fg('primary', '─'.repeat(width));
    const status =
      entry.status === undefined
        ? ''
        : ` ${currentTheme.fg(toneColor(entry.statusTone), `[${singleLine(entry.status)}]`)}`;
    const lines: string[] = [
      border,
      currentTheme.boldFg('primary', ` ${this.props.title} / ${singleLine(entry.name)}`) + status,
      this.hintLine(),
    ];
    for (const line of statusLines) lines.push(currentTheme.fg('text', ` ${line}`));
    lines.push('');

    const innerWidth = Math.max(1, width - 4);
    const line = (content: string): string => {
      const clipped = truncateToWidth(content, innerWidth);
      const pad = ' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
      return (
        currentTheme.fg('primary', '│') +
        ' ' +
        clipped +
        pad +
        ' ' +
        currentTheme.fg('primary', '│')
      );
    };
    lines.push(currentTheme.fg('primary', '┌' + '─'.repeat(Math.max(0, width - 2)) + '┐'));
    if (entry.detail !== undefined) lines.push(line(currentTheme.fg('textMuted', `  ${singleLine(entry.detail)}`)));
    if (entry.badges !== undefined && entry.badges.length > 0) {
      lines.push(line(currentTheme.fg('textMuted', `  ${entry.badges.join(' · ')}`)));
    }
    if (entry.capabilities !== undefined && entry.capabilities.length > 0) {
      lines.push(line(currentTheme.fg('textMuted', `  capabilities: ${entry.capabilities.join(', ')}`)));
    }
    if (entry.setupHint !== undefined && entry.setupHint.length > 0) {
      lines.push(line(currentTheme.fg('warning', `  setup: ${entry.setupHint}`)));
    }
    lines.push(line(''));

    const actions = entry.actions ?? [];
    if (actions.length === 0) {
      lines.push(line(currentTheme.fg('textMuted', '  No actions available.')));
    } else {
      lines.push(line(currentTheme.fg('textMuted', '  Actions')));
      for (let index = 0; index < actions.length; index++) {
        const action = actions[index]!;
        const pointer = index === this.actionIndex ? currentTheme.fg('primary', SELECT_POINTER) : ' ';
        const label = action.disabled === true
          ? currentTheme.fg('textMuted', action.label)
          : action.tone === 'danger'
            ? currentTheme.fg('error', action.label)
            : currentTheme.fg('text', action.label);
        const description =
          action.description === undefined
            ? ''
            : currentTheme.fg('textMuted', ` — ${action.description}`);
        lines.push(line(`    ${pointer} ${label}${description}`));
      }
      if (this.confirmAction !== undefined) {
        lines.push(line(currentTheme.fg('warning', `  ${this.confirmAction.confirm ?? 'Confirm?'} [y/N]`)));
      }
    }
    lines.push(currentTheme.fg('primary', '└' + '─'.repeat(Math.max(0, width - 2)) + '┘'));

    while (lines.length < rows - 1) lines.push('');
    lines.push(border);
    return lines.slice(0, rows).map((lineText) => truncateToWidth(lineText, width));
  }

  private filteredEntries(): readonly CatalogBrowserEntry[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (query === '') return this.props.entries;
    return this.props.entries.filter((entry) => this.haystack(entry).includes(query));
  }

  private haystack(entry: CatalogBrowserEntry): string {
    return [
      entry.name,
      entry.detail,
      entry.group,
      entry.status,
      ...(entry.badges ?? []),
      ...(entry.capabilities ?? []),
      entry.setupHint,
      ...(entry.actions ?? []).flatMap((action) => [action.label, action.description]),
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(' ')
      .toLowerCase();
  }

  private buildDisplayRows(
    entries: readonly CatalogBrowserEntry[],
    width: number,
  ): { rows: DisplayRow[]; starts: number[] } {
    const rows: DisplayRow[] = [];
    const starts: number[] = [];
    let lastGroup: string | undefined;

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const selected = index === this.selectedIndex;
      const entryStart = rows.length;
      if (entry.group !== undefined && entry.group !== lastGroup) {
        lastGroup = entry.group;
        rows.push({
          text: currentTheme.fg('textMuted', ` ${entry.group.toUpperCase()}`),
        });
      }

      if (this.props.variant === 'cards') {
        starts[index] = entryStart;
        rows.push(...this.buildCardRows(entry, selected, width));
        continue;
      }

      const pointer = selected ? currentTheme.fg('primary', SELECT_POINTER) : ' ';
      const name = selected
        ? currentTheme.boldFg('primary', singleLine(entry.name))
        : currentTheme.fg('text', singleLine(entry.name));
      const status =
        entry.status === undefined
          ? ''
          : ` ${currentTheme.fg(toneColor(entry.statusTone), `[${singleLine(entry.status)}]`)}`;
      const badges =
        entry.badges === undefined || entry.badges.length === 0
          ? ''
          : currentTheme.fg('textMuted', ` · ${entry.badges.join(' · ')}`);
      starts[index] = entryStart;
      rows.push({
        text: truncateToWidth(`  ${pointer} ${name}${status}${badges}`, width),
        entryIndex: index,
      });

      if (entry.detail !== undefined) {
        rows.push({
          text: truncateToWidth(currentTheme.fg('textMuted', `    ${singleLine(entry.detail)}`), width),
        });
      }
    }

    return { rows, starts };
  }

  private buildCardRows(
    entry: CatalogBrowserEntry,
    selected: boolean,
    width: number,
  ): DisplayRow[] {
    const borderTone = selected ? 'primary' : 'textMuted';
    const innerWidth = Math.max(1, width - 4);
    const lines: string[] = [];
    const line = (content: string): string => {
      const clipped = truncateToWidth(content, innerWidth);
      const pad = ' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
      return (
        currentTheme.fg(borderTone, '│') +
        ' ' +
        clipped +
        pad +
        ' ' +
        currentTheme.fg(borderTone, '│')
      );
    };
    const top = currentTheme.fg(borderTone, '┌' + '─'.repeat(Math.max(0, width - 2)) + '┐');
    const bottom = currentTheme.fg(borderTone, '└' + '─'.repeat(Math.max(0, width - 2)) + '┘');
    const pointer = selected ? currentTheme.fg('primary', SELECT_POINTER) : ' ';
    const name = selected
      ? currentTheme.boldFg('primary', singleLine(entry.name))
      : currentTheme.fg('text', singleLine(entry.name));
    const status =
      entry.status === undefined
        ? ''
        : ` ${currentTheme.fg(toneColor(entry.statusTone), `[${singleLine(entry.status)}]`)}`;

    lines.push(top, line(`${pointer} ${name}${status}`));
    if (entry.detail !== undefined) {
      lines.push(line(currentTheme.fg('textMuted', `  ${singleLine(entry.detail)}`)));
    }
    if (entry.badges !== undefined && entry.badges.length > 0) {
      lines.push(line(currentTheme.fg('textMuted', `  ${entry.badges.join(' · ')}`)));
    }
    if (selected && entry.actions !== undefined && entry.actions.length > 0) {
      lines.push(line(currentTheme.fg('textMuted', '  Enter to open')));
    }
    lines.push(bottom, '');
    return lines.map((text) => ({ text }));
  }

  private adjustScroll(starts: number[], total: number, listHeight: number): void {
    const start = starts[this.selectedIndex] ?? 0;
    const end = (starts[this.selectedIndex + 1] ?? total) - 1;
    if (start < this.scroll) this.scroll = start;
    else if (end >= this.scroll + listHeight) this.scroll = end - listHeight + 1;
    const maxScroll = Math.max(0, total - listHeight);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
  }

  private hintLine(): string {
    if (this.confirmAction !== undefined) {
      return currentTheme.fg('warning', ` ${this.confirmAction.confirm ?? 'Confirm?'} [y/N]`);
    }
    if (this.detailEntry !== undefined) {
      const segments = ['↑↓ action', 'Enter run'];
      if (this.props.onRefresh !== undefined) segments.push('r refresh');
      segments.push('Esc back');
      return currentTheme.fg('textMuted', ` ${segments.join(' · ')}`);
    }
    if (this.searchMode || this.searchQuery.length > 0) {
      const cursor = this.searchMode ? '▌' : '';
      return (
        currentTheme.fg('text', ` Search: ${this.searchQuery}${cursor}`) +
        currentTheme.fg('textMuted', ' · Enter done · Esc clear')
      );
    }
    const segments = ['↑↓ navigate'];
    if (this.props.searchable === true) segments.push('/ search');
    if (this.props.onRefresh !== undefined) segments.push('r refresh');
    if (this.props.onAction !== undefined) segments.push('Enter open');
    else if (this.props.onSelect !== undefined) segments.push('Enter select');
    segments.push('Esc cancel');
    return currentTheme.fg('textMuted', ` ${segments.join(' · ')}`);
  }

  private renderTooSmall(width: number, rows: number): string[] {
    const message = currentTheme.fg(
      'error',
      `Terminal too small (need ≥ ${String(MIN_WIDTH)} × ${String(MIN_HEIGHT)})`,
    );
    const lines = [truncateToWidth(message, width)];
    while (lines.length < rows) lines.push('');
    return lines;
  }
}
