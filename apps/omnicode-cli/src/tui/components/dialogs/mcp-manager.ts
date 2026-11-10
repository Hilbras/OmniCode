/**
 * The MCP server manager page.
 *
 * A dedicated list rather than the generic catalog browser: each server gets
 * a name row plus a detail row, a right-aligned status column, and the
 * account / workspace grouping that the managed view actually contains.
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

const STATUS_TEXT: Record<McpServerStatus, string> = {
  connected: 'connected',
  pending: 'pending',
  failed: 'failed',
  'needs-auth': 'needs auth',
  disabled: 'disabled',
};

const MIN_WIDTH = 30;
const MIN_HEIGHT = 8;
const HEADER_LINES = 3;
const FOOTER_LINES = 2;

export type McpServerStatus = 'connected' | 'pending' | 'failed' | 'needs-auth' | 'disabled';

export interface McpManagerEntry {
  readonly id: string;
  readonly name: string;
  /** The "add a new server" row, rendered apart from real servers. */
  readonly add?: boolean;
  readonly transport?: string;
  readonly target?: string;
  readonly status?: McpServerStatus;
  readonly scope?: string;
  /** Whether the server is enabled; a disabled server is not started. */
  readonly enabled?: boolean;
  readonly toolCount?: number;
  readonly readOnly?: boolean;
  readonly error?: string;
}

export interface McpManagerProps {
  readonly title: string;
  readonly entries: readonly McpManagerEntry[];
  readonly selectedIndex: number;
  readonly status: string | undefined;
  readonly onCancel: () => void;
  readonly onSelect: (entry: McpManagerEntry) => void;
}

export class McpManagerApp extends Container implements Focusable {
  focused = false;

  private props: McpManagerProps;
  private readonly terminal: Terminal;
  private scroll = 0;

  constructor(props: McpManagerProps, terminal: Terminal) {
    super();
    this.props = props;
    this.terminal = terminal;
  }

  setProps(props: McpManagerProps): void {
    this.props = props;
    this.props = {
      ...props,
      selectedIndex: Math.min(props.selectedIndex, Math.max(0, props.entries.length - 1)),
    };
    this.invalidate();
  }

  handleInput(data: string): void {
    const key = printableChar(data);
    if (matchesKey(data, Key.escape)) {
      this.props.onCancel();
      return;
    }
    if (this.props.entries.length === 0) return;
    if (matchesKey(data, Key.enter)) {
      const entry = this.props.entries[this.props.selectedIndex];
      if (entry !== undefined) this.props.onSelect(entry);
      return;
    }
    if (matchesKey(data, Key.up) || key === 'k') {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || key === 'j') {
      this.move(1);
    }
  }

  override render(width: number): string[] {
    const rows = Math.max(1, this.terminal.rows);
    if (width < MIN_WIDTH || rows < MIN_HEIGHT) return this.renderTooSmall(width, rows);

    const border = currentTheme.fg('primary', '─'.repeat(width));
    const entries = this.props.entries;
    const servers = entries.filter((entry) => entry.add !== true).length;
    const count =
      servers > 0
        ? currentTheme.fg('textMuted', ` (${String(servers)} server${servers === 1 ? '' : 's'})`)
        : '';

    const lines: string[] = [
      border,
      currentTheme.boldFg('primary', ` ${this.props.title}`) + count,
      currentTheme.fg('textMuted', ' ↑↓ navigate · Enter actions · Esc cancel'),
      '',
    ];
    if (this.props.status !== undefined) {
      for (const line of this.props.status.split('\n')) {
        lines.push(currentTheme.fg('text', ` ${line}`));
      }
      lines.push('');
    }

    const listHeight = Math.max(
      1,
      rows - HEADER_LINES - FOOTER_LINES - lines.length + HEADER_LINES,
    );
    const visible = this.visibleRows(listHeight, width);
    for (const row of visible) lines.push(row);

    while (lines.length < rows - FOOTER_LINES) lines.push('');
    const remaining = this.remainingCount(listHeight);
    if (remaining > 0) {
      lines[lines.length - 1] = currentTheme.fg('textMuted', ` ▼ ${String(remaining)} more`);
    }
    lines.push(border);
    return lines.slice(0, rows).map((line) => truncateToWidth(line, width));
  }

  private visibleRows(listHeight: number, width: number): string[] {
    const rows: string[] = [];
    let used = 0;
    for (let index = 0; index < this.props.entries.length; index++) {
      const entry = this.props.entries[index]!;
      const entryRows = entry.add === true ? 1 : 2;
      if (used + entryRows > listHeight) break;
      if (entry.add === true) {
        rows.push(this.addRow(entry, index === this.props.selectedIndex));
      } else {
        rows.push(this.nameRow(entry, index === this.props.selectedIndex, width));
        rows.push(this.detailRow(entry));
      }
      used += entryRows;
    }
    return rows;
  }

  private remainingCount(listHeight: number): number {
    let used = 0;
    let shown = 0;
    for (const entry of this.props.entries) {
      const entryRows = entry.add === true ? 1 : 2;
      if (used + entryRows > listHeight) break;
      used += entryRows;
      shown++;
    }
    return Math.max(0, this.props.entries.length - shown);
  }

  private addRow(entry: McpManagerEntry, selected: boolean): string {
    const pointer = selected ? currentTheme.fg('primary', SELECT_POINTER) : ' ';
    const label = selected
      ? currentTheme.boldFg('primary', 'Add an MCP server')
      : currentTheme.fg('accent', 'Add an MCP server');
    return ` ${pointer} ${label}`;
  }

  private nameRow(entry: McpManagerEntry, selected: boolean, width: number): string {
    const column = Math.max(24, width - 2);
    const rightParts: string[] = [];
    const rightPlain: string[] = [];
    if (entry.enabled === false) {
      rightParts.push(currentTheme.fg('textDim', 'disabled'));
      rightPlain.push('disabled');
    }
    if (entry.transport !== undefined) {
      rightParts.push(entry.transport);
      rightPlain.push(entry.transport);
    }
    if (entry.status !== undefined) {
      rightParts.push(this.statusLabel(entry.status));
      rightPlain.push(STATUS_TEXT[entry.status]);
    }
    const rightText = rightPlain.join(' · ');
    const maxNameLength = Math.max(4, column - 3 - rightText.length - 2);
    const plainName =
      entry.name.length > maxNameLength ? `${entry.name.slice(0, maxNameLength - 1)}…` : entry.name;
    const pointer = selected ? currentTheme.fg('primary', SELECT_POINTER) : ' ';
    const name = selected
      ? currentTheme.boldFg('primary', plainName)
      : currentTheme.fg('text', plainName);
    const right = rightParts.length === 0 ? '' : ` ${rightParts.join(' · ')}`;
    const gap = Math.max(1, column - (3 + plainName.length) - rightText.length - 1);
    return ` ${pointer} ${name}${' '.repeat(gap)}${right}`.trimEnd();
  }

  private detailRow(entry: McpManagerEntry): string {
    const parts: string[] = [];
    if (entry.target !== undefined && entry.target.length > 0) parts.push(entry.target);
    if (entry.toolCount !== undefined && entry.toolCount > 0) {
      parts.push(`${String(entry.toolCount)} tool${entry.toolCount === 1 ? '' : 's'}`);
    }
    if (entry.scope !== undefined) parts.push(`${entry.scope} scope`);
    if (entry.readOnly === true) parts.push('read-only');
    if (entry.error !== undefined && entry.error.length > 0) parts.push(entry.error);
    return `    ${currentTheme.fg('textMuted', parts.join(' · '))}`;
  }

  private statusLabel(status: McpServerStatus): string {
    switch (status) {
      case 'connected':
        return currentTheme.fg('success', 'connected');
      case 'pending':
        return currentTheme.fg('textMuted', 'pending');
      case 'failed':
        return currentTheme.fg('error', 'failed');
      case 'needs-auth':
        return currentTheme.fg('warning', 'needs auth');
      case 'disabled':
        return currentTheme.fg('textDim', 'disabled');
    }
  }

  private move(delta: number): void {
    const next = this.props.selectedIndex + delta;
    if (next < 0 || next >= this.props.entries.length) return;
    this.setProps({ ...this.props, selectedIndex: next });
  }

  private renderTooSmall(width: number, rows: number): string[] {
    const message = 'Terminal too small for the MCP manager.';
    return Array.from({ length: Math.max(1, rows) }, () => truncateToWidth(message, width));
  }
}
