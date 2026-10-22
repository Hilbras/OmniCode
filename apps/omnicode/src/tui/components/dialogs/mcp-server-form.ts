/**
 * A single-page form for adding or editing an MCP server: every field is
 * visible at once, the user moves between them, and `Enter` saves.
 */

import type { McpServerConfig } from '@hilbras/omnicode-api';
import {
  Container,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '@hilbras/omnicode-tui';

import { currentTheme } from '#/tui/theme';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';

export type McpServerFormResult =
  | { readonly kind: 'ok'; readonly config: McpServerConfig }
  | { readonly kind: 'cancel' };

export type McpServerFormMode = 'add' | 'edit';

const TRANSPORTS = ['stdio', 'http', 'sse'] as const;
type Transport = (typeof TRANSPORTS)[number];

type FieldIndex = 0 | 1 | 2 | 3;

const NAME_LABEL = 'Name';
const TRANSPORT_LABEL = 'Transport';
const COMMAND_LABEL = 'Command';
const URL_LABEL = 'URL';
const ARGS_LABEL = 'Arguments';
const BEARER_LABEL = 'Bearer token env var';

export class McpServerFormComponent extends Container implements Focusable {
  focused = false;

  private readonly onDone: (result: McpServerFormResult) => void;
  private readonly mode: McpServerFormMode;
  private readonly name = new Input({ prompt: '' });
  private readonly target = new Input({ prompt: '' });
  private readonly extra = new Input({ prompt: '' });
  private transport: Transport = 'stdio';
  private field: FieldIndex = 0;
  private done = false;
  private readonly edited: [boolean, boolean, boolean, boolean] = [false, false, false, false];

  constructor(
    mode: McpServerFormMode,
    existing: McpServerConfig | undefined,
    onDone: (result: McpServerFormResult) => void,
  ) {
    super();
    this.mode = mode;
    this.onDone = onDone;
    if (existing !== undefined) {
      this.name.setValue(existing.name);
      this.transport = existing.transport;
      if (existing.transport === 'stdio') {
        this.target.setValue(existing.command ?? '');
        this.extra.setValue((existing.args ?? []).join(' '));
      } else {
        this.target.setValue(existing.url ?? '');
        this.extra.setValue(existing.bearerTokenEnvVar ?? '');
      }
    }
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.cancel();
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) {
      this.field = ((this.field + 1) % 4) as FieldIndex;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.field = ((this.field + 3) % 4) as FieldIndex;
      this.invalidate();
      return;
    }
    if (this.field === 1) {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        this.cycleTransport(matchesKey(data, Key.left) ? -1 : 1);
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.submit();
        return;
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.submit();
      return;
    }
    const printable = printableChar(data);
    if (isPrintableChar(printable)) {
      this.replaceOnFirstType(this.field, data);
      return;
    }
    if (!this.edited[this.field]) {
      this.edited[this.field] = true;
      this.activeInput().setValue('');
    }
    this.activeInput().handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.name.invalidate();
    this.target.invalidate();
    this.extra.invalidate();
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const title = this.mode === 'edit' ? 'Edit MCP server' : 'Add an MCP server';
    const rows: string[] = [title, ''];

    rows.push(this.fieldRow(NAME_LABEL, this.name, 0, innerWidth));
    rows.push(this.transportRow());
    if (this.transport === 'stdio') {
      rows.push(this.fieldRow(COMMAND_LABEL, this.target, 2, innerWidth));
      rows.push(this.fieldRow(ARGS_LABEL, this.extra, 3, innerWidth));
    } else {
      rows.push(this.fieldRow(URL_LABEL, this.target, 2, innerWidth));
      rows.push(this.fieldRow(BEARER_LABEL, this.extra, 3, innerWidth));
    }
    rows.push('');
    rows.push(
      this.transport === 'stdio'
        ? 'Tab or ↑↓ to move · ←→ to change transport · Enter to save · Esc to cancel'
        : 'Tab or ↑↓ to move · ←→ to change transport · Enter to save · Esc to cancel',
    );

    const lines: string[] = ['', currentTheme.fg('primary', '╭' + '─'.repeat(safeWidth - 2) + '╮')];
    for (const row of rows) {
      const padded = truncateToWidth(row, innerWidth, '…').padEnd(innerWidth);
      lines.push(currentTheme.fg('primary', '│') + '  ' + padded + currentTheme.fg('primary', '│'));
    }
    lines.push(currentTheme.fg('primary', '╰' + '─'.repeat(safeWidth - 2) + '╯'));
    lines.push('');
    return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
  }

  private fieldRow(label: string, input: Input, index: FieldIndex, innerWidth: number): string {
    input.focused = this.focused && !this.done && this.field === index;
    const rendered = input.render(Math.max(4, innerWidth - label.length - 3))[0] ?? '';
    return `${currentTheme.fg('textDim', `${label.padEnd(label.length + 2)}`)}${rendered}`;
  }

  private transportRow(): string {
    const marker = this.field === 1 ? currentTheme.fg('primary', '›') : ' ';
    const options = TRANSPORTS.map((transport) =>
      transport === this.transport
        ? currentTheme.boldFg('primary', ` ${transport} `)
        : currentTheme.fg('textDim', ` ${transport} `),
    ).join(currentTheme.fg('textDim', '/'));
    return `${currentTheme.fg('textDim', `${TRANSPORT_LABEL.padEnd(TRANSPORT_LABEL.length + 2)}`)}${marker}${options}`;
  }

  private replaceOnFirstType(field: FieldIndex, data: string): void {
    if (field === 1) return;
    if (!this.edited[field]) {
      this.edited[field] = true;
      this.activeInput().setValue('');
    }
    this.activeInput().handleInput(data);
  }

  private activeInput(): Input {
    if (this.field === 0) return this.name;
    if (this.field === 2) return this.target;
    return this.extra;
  }

  private cycleTransport(direction: number): void {
    const index = TRANSPORTS.indexOf(this.transport);
    const next = (index + direction + TRANSPORTS.length) % TRANSPORTS.length;
    this.transport = TRANSPORTS[next]!;
    this.invalidate();
  }

  private submit(): void {
    if (this.done) return;
    const name = this.name.getValue().trim();
    if (name.length === 0) return;
    const target = this.target.getValue().trim();
    if (target.length === 0) return;
    this.done = true;
    this.onDone({ kind: 'ok', config: this.buildConfig(name, target) });
  }

  private buildConfig(name: string, target: string): McpServerConfig {
    const extra = this.extra.getValue().trim();
    if (this.transport === 'stdio') {
      return {
        name,
        transport: 'stdio',
        command: target,
        ...(extra.length > 0 ? { args: extra.split(/\s+/) } : {}),
      };
    }
    return {
      name,
      transport: this.transport,
      url: target,
      ...(extra.length > 0 ? { bearerTokenEnvVar: extra } : {}),
    };
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }
}
