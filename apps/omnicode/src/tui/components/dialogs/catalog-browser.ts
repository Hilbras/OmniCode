/**
 * CatalogBrowserApp — full-screen takeover listing a read-only catalog
 * (available skills, available subagent profiles).
 *
 * Presentation only: the controller feeds entries in through `setProps` and
 * owns the screen takeover; this component never talks to the SDK.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
  type Terminal,
} from '@hilbras/omnicode-tui';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';

/** Minimum dimensions before the page degrades to a "too small" notice. */
const MIN_WIDTH = 24;
const MIN_HEIGHT = 8;

export interface CatalogBrowserEntry {
  /** Stable identity of the entry, when the catalog has one. */
  readonly id?: string;
  readonly name: string;
  /** Secondary line under the name (description / when-to-use hint). */
  readonly detail?: string;
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
  /**
   * Confirmation handler. Omitted for a strictly read-only catalog; when set,
   * Enter selects the highlighted entry and the hint grows an
   * `Enter select` segment.
   */
  readonly onSelect?: (entry: CatalogBrowserEntry) => void;
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

export class CatalogBrowserApp extends Container implements Focusable {
  focused = false;

  private props: CatalogBrowserProps;
  private readonly terminal: Terminal;
  private selectedIndex = 0;
  private scroll = 0;

  constructor(props: CatalogBrowserProps, terminal: Terminal) {
    super();
    this.props = props;
    this.terminal = terminal;
  }

  setProps(props: CatalogBrowserProps): void {
    this.props = props;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, props.entries.length - 1));
    this.invalidate();
  }

  handleInput(data: string): void {
    const key = printableChar(data);
    if (matchesKey(data, Key.escape) || key === 'q' || key === 'Q') {
      this.props.onCancel();
      return;
    }
    if (this.props.entries.length === 0) return;
    if (matchesKey(data, Key.enter) && this.props.onSelect !== undefined) {
      const entry = this.props.entries[this.selectedIndex];
      if (entry !== undefined) this.props.onSelect(entry);
      return;
    }
    if (matchesKey(data, Key.up) || key === 'k') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || key === 'j') {
      this.selectedIndex = Math.min(this.props.entries.length - 1, this.selectedIndex + 1);
      this.invalidate();
    }
  }

  override render(width: number): string[] {
    const rows = Math.max(1, this.terminal.rows);
    if (width < MIN_WIDTH || rows < MIN_HEIGHT) return this.renderTooSmall(width, rows);

    const statusLines = this.props.status === undefined ? [] : this.props.status.split('\n');
    const headerHeight = 4 + statusLines.length;
    const listHeight = rows - 7 - statusLines.length;
    const border = currentTheme.fg('primary', '─'.repeat(width));
    const entries = this.props.entries;
    const count =
      entries.length > 0 ? currentTheme.fg('textMuted', ` (${String(entries.length)})`) : '';

    const lines: string[] = [
      border,
      currentTheme.boldFg('primary', ` ${this.props.title}`) + count,
      currentTheme.fg('textMuted', this.hint()),
    ];
    for (const line of statusLines) {
      lines.push(currentTheme.fg('text', ` ${line}`));
    }
    lines.push('');

    let more = 0;
    if (this.props.error !== undefined) {
      lines.push(currentTheme.fg('error', ` ${singleLine(this.props.error)}`));
    } else if (entries.length === 0) {
      for (const line of this.props.emptyMessage.split('\n')) {
        lines.push(currentTheme.fg('textMuted', ` ${line}`));
      }
    } else {
      const { offsets, total } = this.rowOffsets();
      this.adjustScroll(listHeight, offsets, total);
      more = entries.length - (this.lastVisibleIndex(offsets, listHeight) + 1);
      const listRows = Array.from({ length: listHeight }, () => '');
      for (let index = 0; index < entries.length; index++) {
        const offset = offsets[index]!;
        if (offset >= this.scroll + listHeight) break;
        const entry = entries[index]!;
        const selected = index === this.selectedIndex;
        const pointer = selected ? currentTheme.fg('primary', SELECT_POINTER) : ' ';
        const name = selected
          ? currentTheme.boldFg('primary', singleLine(entry.name))
          : currentTheme.fg('text', singleLine(entry.name));
        const row = offset - this.scroll;
        if (row >= 0 && row < listHeight)
          listRows[row] = truncateToWidth(`  ${pointer} ${name}`, width);
        if (entry.detail === undefined) continue;
        const detailRow = row + 1;
        if (detailRow >= 0 && detailRow < listHeight) {
          listRows[detailRow] = truncateToWidth(
            currentTheme.fg('textMuted', `    ${singleLine(entry.detail)}`),
            width,
          );
        }
      }
      for (const row of listRows) lines.push(row);
    }

    while (lines.length < headerHeight + listHeight) lines.push('');
    lines.push('');
    lines.push(more > 0 ? currentTheme.fg('textMuted', ` ▼ ${String(more)} more`) : '');
    while (lines.length < rows - 1) lines.push('');
    lines.push(border);
    return lines.slice(0, rows).map((line) => truncateToWidth(line, width));
  }

  /** Keyboard hint line; `Enter select` appears only for a selectable catalog. */
  private hint(): string {
    const segments = ['↑↓ navigate'];
    if (this.props.onSelect !== undefined) segments.push('Enter select');
    segments.push('Esc cancel');
    return ` ${segments.join(' · ')}`;
  }

  /** Row offset of every entry, plus the total row count. */
  private rowOffsets(): { offsets: number[]; total: number } {
    const offsets: number[] = [];
    let total = 0;
    for (const entry of this.props.entries) {
      offsets.push(total);
      total += entry.detail === undefined ? 1 : 2;
    }
    return { offsets, total };
  }

  private adjustScroll(listHeight: number, offsets: number[], total: number): void {
    const start = offsets[this.selectedIndex] ?? 0;
    const end = (offsets[this.selectedIndex + 1] ?? total) - 1;
    if (start < this.scroll) this.scroll = start;
    else if (end >= this.scroll + listHeight) this.scroll = end - listHeight + 1;
    const maxScroll = Math.max(0, total - listHeight);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
  }

  /** Index of the last entry whose first row still fits in the visible window. */
  private lastVisibleIndex(offsets: number[], listHeight: number): number {
    let last = -1;
    for (let index = 0; index < offsets.length; index++) {
      if (offsets[index]! >= this.scroll + listHeight) break;
      last = index;
    }
    return last;
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
