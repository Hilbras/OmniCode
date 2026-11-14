/**
 * ToolOutputViewer — full-screen viewer for one tool call's result output.
 * Same skeleton as `TaskOutputViewer` (header / framed scrolling body /
 * footer with position), but the identity line is the tool name and its key
 * argument instead of a background-task id, and the content is a snapshot:
 * tool results never grow after `tool.result` lands.
 */

import { Container, Key, matchesKey, type Terminal, truncateToWidth, visibleWidth, type Focusable } from '@hilbras/omnicode-tui';

import { currentTheme } from '#/tui/theme';
import { sanitizeShellOutput } from '#/tui/utils/shell-output';
import { printableChar } from '@/tui/utils/printable-key';

const ELLIPSIS = '…';

export interface ToolOutputViewerProps {
  readonly toolName: string;
  readonly headerDetail: string | undefined;
  readonly isError: boolean;
  readonly output: string;
  readonly onClose: () => void;
}

function fitExactly(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w === width) return line;
  if (w > width) return truncateToWidth(line, width, ELLIPSIS);
  return line + ' '.repeat(width - w);
}

export class ToolOutputViewer extends Container implements Focusable {
  focused = false;

  private props: ToolOutputViewerProps;
  private readonly terminal: Terminal;
  private lines: string[];
  private scrollTop = 0;

  constructor(props: ToolOutputViewerProps, terminal: Terminal) {
    super();
    this.props = props;
    this.terminal = terminal;
    this.lines = this.splitOutput(props.output);
  }

  setProps(next: ToolOutputViewerProps): void {
    this.props = next;
    this.lines = this.splitOutput(next.output);
    this.scrollTop = Math.min(this.scrollTop, this.maxScroll());
    this.invalidate();
  }

  private splitOutput(output: string): string[] {
    return (output.length > 0 ? sanitizeShellOutput(output) : '[no output]').split('\n');
  }

  handleInput(data: string): void {
    const visible = this.viewableRows();
    const k = printableChar(data);

    if (matchesKey(data, Key.escape) || k === 'q' || k === 'Q') {
      this.props.onClose();
      return;
    }
    if (matchesKey(data, Key.up) || k === 'k') {
      this.scrollBy(-1);
      return;
    }
    if (matchesKey(data, Key.down) || k === 'j') {
      this.scrollBy(1);
      return;
    }
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl('u'))) {
      this.scrollBy(-Math.max(1, visible - 1));
      return;
    }
    if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl('d'))) {
      this.scrollBy(Math.max(1, visible - 1));
      return;
    }
    if (matchesKey(data, Key.home) || k === 'g') {
      this.scrollTo(0);
      return;
    }
    if (matchesKey(data, Key.end) || k === 'G') {
      this.scrollTo(this.maxScroll());
      return;
    }
  }

  private scrollBy(delta: number): void {
    this.scrollTo(this.scrollTop + delta);
  }

  private scrollTo(target: number): void {
    this.scrollTop = Math.max(0, Math.min(target, this.maxScroll()));
    this.invalidate();
  }

  private maxScroll(): number {
    return Math.max(0, this.lines.length - this.viewableRows());
  }

  private viewableRows(): number {
    return Math.max(1, this.terminal.rows - 4);
  }

  override render(width: number): string[] {
    const rows = Math.max(3, this.terminal.rows);
    const bodyHeight = rows - 2;

    const header = this.renderHeader(width);
    const body = this.renderBody(width, bodyHeight);
    const footer = this.renderFooter(width, bodyHeight);

    const out: string[] = [header];
    for (const line of body) out.push(line);
    out.push(footer);
    return out;
  }

  private renderHeader(width: number): string {
    const title = currentTheme.boldFg('primary', ' Tool output ');
    const name = currentTheme.boldFg('text', this.props.toolName);
    const segments: string[] = [name];
    if (this.props.isError) {
      segments.push(currentTheme.fg('error', 'error'));
    }
    const detail = this.props.headerDetail;
    if (detail !== undefined && detail.length > 0) {
      segments.push(currentTheme.fg('textMuted', detail));
    }
    return fitExactly(title + segments.join('  '), width);
  }

  private renderBody(width: number, bodyHeight: number): string[] {
    const innerWidth = Math.max(1, width - 4);

    const max = this.maxScroll();
    if (this.scrollTop > max) this.scrollTop = max;
    if (this.scrollTop < 0) this.scrollTop = 0;

    const viewRows = bodyHeight - 2;
    const top = currentTheme.fg('primary', '┌' + '─'.repeat(Math.max(0, width - 2)) + '┐');
    const bottom = currentTheme.fg('primary', '└' + '─'.repeat(Math.max(0, width - 2)) + '┘');

    const out: string[] = [top];
    for (let i = 0; i < viewRows; i++) {
      const lineIndex = this.scrollTop + i;
      const raw = this.lines[lineIndex] ?? '';
      const inner = fitExactly(
        this.props.isError ? currentTheme.fg('error', raw) : currentTheme.fg('text', raw),
        innerWidth,
      );
      out.push(currentTheme.fg('primary', '│ ') + inner + currentTheme.fg('primary', ' │'));
    }
    out.push(bottom);
    return out;
  }

  private renderFooter(width: number, bodyHeight: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);

    const total = this.lines.length;
    const viewRows = Math.max(1, bodyHeight - 2);
    const maxScroll = Math.max(0, total - viewRows);
    const percent = maxScroll === 0 ? 100 : Math.round((this.scrollTop / maxScroll) * 100);
    const lineFrom = this.scrollTop + 1;
    const lineTo = Math.min(total, this.scrollTop + viewRows);

    const position = currentTheme.fg(
      'textMuted',
      ` ${String(lineFrom)}-${String(lineTo)} / ${String(total)} (${String(percent)}%) `,
    );
    const keys =
      `${key('↑↓')} ${dim('line')}  ` +
      `${key('PgUp/PgDn/Ctrl+U/D')} ${dim('page')}  ` +
      `${key('g/G')} ${dim('top/bot')}  ` +
      `${key('Q/Esc')} ${dim('close')}`;
    const left = ` ${keys}`;
    const leftW = visibleWidth(left);
    const rightW = visibleWidth(position);
    if (leftW + 2 + rightW <= width) {
      return left + ' '.repeat(width - leftW - rightW) + position;
    }
    return fitExactly(left, width);
  }
}
