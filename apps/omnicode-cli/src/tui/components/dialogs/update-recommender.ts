/**
 * UpdateRecommenderApp — full-screen view of a pending Omnicode update:
 * what changed between the running version and the latest, plus the
 * install action.
 *
 * Mounted by `update-recommender` (the controller) via screen takeover,
 * like `TasksBrowserApp`. Layout: header row, scrolling release-notes
 * body, footer with the action choices (install / copy command / open
 * changelog / dismiss) selected with ↑↓ + Enter.
 */

import {
  Container,
  Key,
  type Focusable,
  matchesKey,
  type Terminal,
  truncateToWidth,
  visibleWidth,
} from '@hilbras/omnicode-tui';

import { CHANGELOG_URL } from '#/cli/update/prompt';
import type { InstallSource } from '#/cli/update/types';
import { currentTheme } from '#/tui/theme';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { printableChar } from '#/tui/utils/printable-key';

const ELLIPSIS = '…';

const MIN_WIDTH = 48;
const MIN_HEIGHT = 10;

export type UpdateAction = 'install' | 'copyCommand' | 'openChangelog' | 'dismiss';

export interface UpdateRecommenderProps {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly installSource: InstallSource;
  readonly installCommand: string;
  readonly noteSections: readonly {
    readonly version: string;
    readonly items: readonly string[];
  }[];
  readonly omittedItems: number;
  readonly changelogAvailable: boolean;
  /** True when no update is available — the panel opened as a manual check. */
  readonly upToDate: boolean;
  /** Present after the user chose "install now" and it finished. */
  readonly installResult: { readonly ok: boolean; readonly detail?: string } | undefined;
  readonly flashMessage: string | undefined;
  readonly onInstall: () => void;
  readonly onCopyCommand: () => void;
  readonly onOpenChangelog: () => void;
  readonly onDismiss: () => void;
  readonly onCancel: () => void;
}

export class UpdateRecommenderApp extends Container implements Focusable {
  focused = false;

  private props: UpdateRecommenderProps;
  private readonly terminal: Terminal;
  private actionIndex = 0;
  private noteScrollTop = 0;

  constructor(props: UpdateRecommenderProps, terminal: Terminal) {
    super();
    this.props = props;
    this.terminal = terminal;
  }

  setProps(next: UpdateRecommenderProps): void {
    this.props = next;
    if (this.actionIndex >= this.visibleActions().length) {
      this.actionIndex = Math.max(0, this.visibleActions().length - 1);
    }
    this.invalidate();
  }

  /** The last props passed to this component — used by the controller to patch a single field. */
  currentProps(): UpdateRecommenderProps {
    return this.props;
  }

  handleInput(data: string): void {
    const k = printableChar(data);
    if (matchesKey(data, Key.escape) || k === 'q' || k === 'Q') {
      this.props.onCancel();
      return;
    }
    const actions = this.visibleActions();
    if (matchesKey(data, Key.up) || k === 'k') {
      this.actionIndex = Math.max(0, this.actionIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || k === 'j') {
      this.actionIndex = Math.min(actions.length - 1, this.actionIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageUp) || k === 'u') {
      this.scrollNotes(-Math.max(1, Math.floor(this.terminal.rows / 2)));
      return;
    }
    if (matchesKey(data, Key.pageDown) || k === 'd') {
      this.scrollNotes(Math.max(1, Math.floor(this.terminal.rows / 2)));
      return;
    }
    if (matchesKey(data, Key.enter) || k === 'x' || k === 'X') {
      const action = actions[this.actionIndex];
      switch (action) {
        case 'install':
          this.props.onInstall();
          return;
        case 'copyCommand':
          this.props.onCopyCommand();
          return;
        case 'openChangelog':
          this.props.onOpenChangelog();
          return;
        case 'dismiss':
          this.props.onDismiss();
          return;
        case undefined:
          return;
      }
    }
  }

  override render(width: number): string[] {
    const rows = Math.max(3, this.terminal.rows);
    if (width < MIN_WIDTH || rows < MIN_HEIGHT) {
      return this.renderTooSmall(width, rows);
    }

    const header = this.renderHeader(width);
    const footer = this.renderFooter(width);
    const bodyHeight = rows - 2;
    const body = this.renderBody(width, bodyHeight);

    const lines: string[] = [header];
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(body[i] ?? ' '.repeat(width));
    }
    lines.push(footer);
    return lines;
  }

  private renderTooSmall(width: number, rows: number): string[] {
    const msg = currentTheme.fg('warning', ' Terminal too small for the update panel ');
    const lines: string[] = [];
    for (let i = 0; i < rows; i++) {
      lines.push(i === 0 ? msg : ' '.repeat(Math.max(0, width - visibleWidth(msg))));
    }
    return lines;
  }

  private renderHeader(width: number): string {
    if (this.props.upToDate) {
      const title = currentTheme.boldFg('primary', ' YOU ARE UP TO DATE ');
      const version = currentTheme.fg('textMuted', ` ${this.props.currentVersion} `);
      return fitExactly(title + version, width);
    }
    const title = currentTheme.boldFg('primary', ' UPDATE AVAILABLE ');
    const arrow = currentTheme.fg(
      'textMuted',
      ` ${this.props.currentVersion} → ${this.props.latestVersion} `,
    );
    const source = currentTheme.fg('textMuted', ` via ${this.props.installSource} `);
    return fitExactly(title + arrow + source, width);
  }

  private renderFooter(width: number): string {
    const key = (text: string): string => currentTheme.boldFg('primary', text);
    const dim = (text: string): string => currentTheme.fg('textMuted', text);
    const actions = this.visibleActions();
    const parts: string[] = [];
    const labels: Record<UpdateAction, string> = {
      install: 'install',
      copyCommand: 'copy command',
      openChangelog: 'changelog',
      dismiss: 'dismiss',
    };
    for (let i = 0; i < actions.length; i++) {
      const pointer = i === this.actionIndex ? `${SELECT_POINTER} ` : '  ';
      const label = labels[actions[i]!];
      parts.push(pointer === `${SELECT_POINTER} ` ? key(pointer + label) : pointer + dim(label));
    }
    parts.push(`${key('Esc/Q')} ${dim('close')} `);
    let left = parts.join('  ');
    const flash = this.props.flashMessage;
    if (flash !== undefined && flash.length > 0) {
      const flashStyled = currentTheme.fg('success', ` ${flash} `);
      const total = visibleWidth(left) + visibleWidth(flashStyled);
      if (total <= width) {
        left = left + ' '.repeat(width - total) + flashStyled;
      }
    }
    return fitExactly(left, width);
  }

  private visibleActions(): readonly UpdateAction[] {
    if (this.props.upToDate) return [];
    const actions: UpdateAction[] = ['install', 'copyCommand'];
    if (this.props.changelogAvailable) actions.push('openChangelog');
    actions.push('dismiss');
    return actions;
  }

  private scrollNotes(delta: number): void {
    this.noteScrollTop = Math.max(0, this.noteScrollTop + delta);
    this.invalidate();
  }

  private allBodyLines(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    if (this.props.noteSections.length === 0 && this.props.omittedItems === 0) {
      lines.push(currentTheme.fg('textMuted', ' No release notes available in this build. '));
      lines.push(currentTheme.fg('textMuted', ` Full changelog: ${CHANGELOG_URL} `));
      return lines;
    }
    for (const section of this.props.noteSections) {
      lines.push(currentTheme.boldFg('success', ` v${section.version} `));
      for (const item of section.items) {
        for (const wrapped of wrapToWidth(item, innerWidth)) {
          lines.push(currentTheme.fg('text', wrapped));
        }
      }
    }
    if (this.props.omittedItems > 0) {
      lines.push(
        currentTheme.fg(
          'textMuted',
          ` …and ${String(this.props.omittedItems)} more change${this.props.omittedItems === 1 ? '' : 's'} — open the full changelog`,
        ),
      );
    }
    const result = this.props.installResult !== undefined
      ? [
          this.props.installResult.ok
            ? currentTheme.fg('success', ' Installed. Restart the CLI to use the new version.')
            : currentTheme.fg('error', ` Install failed: ${this.props.installResult.detail ?? 'unknown error'}`),
          ...lines,
        ]
      : lines;
    return result.map((line) => fitExactly(line, innerWidth));
  }

  private renderBody(width: number, bodyHeight: number): string[] {
    const all = this.allBodyLines(width);
    const max = Math.max(0, all.length - bodyHeight);
    this.noteScrollTop = Math.max(0, Math.min(max, this.noteScrollTop));
    const slice = all.slice(this.noteScrollTop, this.noteScrollTop + bodyHeight);
    while (slice.length < bodyHeight) slice.push('');
    return slice;
  }
}

function wrapToWidth(text: string, width: number): string[] {
  if (width < 1) return [text];
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (visibleWidth(remaining) <= width) {
      result.push(remaining);
      return result;
    }
    let cut = width;
    while (cut > 1 && visibleWidth(remaining.slice(0, cut)) > width) cut--;
    result.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, '');
  }
  return result;
}

function fitExactly(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  const w = visibleWidth(s);
  return w === width ? s : s + ' '.repeat(width - w);
}

export type { Focusable } from '@hilbras/omnicode-tui';
