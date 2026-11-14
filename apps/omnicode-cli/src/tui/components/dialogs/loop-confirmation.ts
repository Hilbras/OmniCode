/**
 * LoopConfirmationDialog — shown when the engine's loop watch detects a
 * degenerate output shape (repeated prose or repeated tool results). The
 * turn keeps running behind the dialog: the model already gets a reminder;
 * the user chooses to keep watching or stop the turn now.
 *
 * Layout mirrors the list-dialog spec: top border, title, detail, options
 * with right-column descriptions, bottom border.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@hilbras/omnicode-tui';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '@/tui/utils/printable-key';

export type LoopConfirmationAction = 'continue' | 'stop';

interface LoopOption {
  readonly value: LoopConfirmationAction;
  readonly label: string;
  readonly description?: string;
}

const OPTIONS: readonly LoopOption[] = [
  {
    value: 'continue',
    label: 'Continue the turn',
    description: 'a reminder was sent to the model already',
  },
  {
    value: 'stop',
    label: 'Stop the turn',
    description: 'cancel the running turn now',
  },
];

const KIND_LABEL: Record<'text_loop' | 'result_stagnation', string> = {
  text_loop: 'The agent keeps emitting the same text.',
  result_stagnation: 'The agent keeps repeating the same tool call.',
};

export interface LoopConfirmationDialogOptions {
  readonly kind: 'text_loop' | 'result_stagnation';
  readonly detail: string;
  readonly turnId: number;
  readonly onSelect: (action: LoopConfirmationAction) => void;
  /** Esc dismisses without stopping the turn. */
  readonly onCancel: () => void;
}

export class LoopConfirmationDialog extends Container implements Focusable {
  focused = false;
  private readonly opts: LoopConfirmationDialogOptions;
  private selectedIndex = 0;

  constructor(opts: LoopConfirmationDialogOptions) {
    super();
    this.opts = opts;
  }

  handleInput(data: string): void {
    const key = printableChar(data);
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up) || key === 'k') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down) || key === 'j') {
      this.selectedIndex = Math.min(OPTIONS.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const chosen = OPTIONS[this.selectedIndex];
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
    }
  }

  override render(width: number): string[] {
    const lines: string[] = [
      currentTheme.fg('warning', '─'.repeat(Math.max(0, width))),
      currentTheme.boldFg('warning', ' Agent looks stuck '),
      currentTheme.fg('text', ` ${KIND_LABEL[this.opts.kind]} (turn ${String(this.opts.turnId)})`),
      currentTheme.fg('textMuted', ` ${this.opts.detail}`),
      '',
    ];

    const maxLabelWidth = Math.max(...OPTIONS.map((o) => visibleWidth(o.label)));
    for (let i = 0; i < OPTIONS.length; i++) {
      const opt = OPTIONS[i]!;
      const isSelected = i === this.selectedIndex;
      const pointer = isSelected ? SELECT_POINTER : ' ';
      let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      line += isSelected
        ? currentTheme.boldFg('primary', opt.label)
        : currentTheme.fg('text', opt.label);
      if (opt.description !== undefined) {
        const gap = maxLabelWidth - visibleWidth(opt.label) + 4;
        line += ' '.repeat(gap) + currentTheme.fg('textMuted', opt.description);
      }
      lines.push(line);
    }

    lines.push('');
    lines.push(currentTheme.fg('textMuted', ' ↑↓ navigate · Enter select · Esc continue'));
    lines.push(currentTheme.fg('warning', '─'.repeat(Math.max(0, width))));
    return lines.map((line) => truncateToWidth(line, width));
  }
}
