import type { TurnDiffFile, TurnDiffRenderScope, TurnDiffView } from '@hilbras/omnicode-api';

import { UsagePanelComponent } from '../components/messages/usage-panel';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export type ParsedDiffCommand =
  | { readonly kind: 'latest' }
  | { readonly kind: 'session' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * `/diff` shows the latest turn's file changes; `/diff session` shows every
 * retained turn merged per path. Anything else is a usage hint, not silent
 * reinterpretation.
 */
export function parseDiffCommand(rawArgs: string): ParsedDiffCommand {
  const args = rawArgs.trim();
  if (args.length === 0) return { kind: 'latest' };
  if (args === 'session') return { kind: 'session' };
  return {
    kind: 'error',
    message:
      'Usage: /diff [session] — bare /diff shows the latest turn, /diff session shows the whole session.',
  };
}

export async function handleDiffCommand(host: SlashCommandHost, args: string): Promise<void> {
  const parsed = parseDiffCommand(args);
  if (parsed.kind === 'error') {
    host.showStatus(parsed.message);
    return;
  }
  const scope: TurnDiffRenderScope = parsed.kind === 'session' ? 'session' : 'latest';
  const session = host.requireSession();
  let view: TurnDiffView;
  try {
    view = await session.getTurnDiff({ scope });
  } catch (error) {
    host.showError(`Failed to load the diff: ${formatErrorMessage(error)}`);
    return;
  }
  host.track('diff_view', { scope: view.scope, files: view.files.length });
  host.state.transcriptContainer.addChild(
    new UsagePanelComponent(() => diffPanelLines(view), 'primary', ' Diff '),
  );
  host.state.ui.requestRender();
}

/**
 * Panel body for a rendered turn-diff view: the scope it covers, the renderer
 * output (already capped, with truncation markers inline), and one note per
 * binary/oversize file that the renderer excluded from the body.
 */
export function diffPanelLines(view: TurnDiffView): readonly string[] {
  const lines: string[] = [];
  if (view.scope === 'session') {
    lines.push('Session: every retained turn, merged per file.');
  } else if (view.turnId !== undefined) {
    lines.push(`Turn ${String(view.turnId)}.`);
  }
  lines.push(...view.text.split('\n'));
  lines.push(...unrenderableNotes(view.files));
  return lines;
}

function unrenderableNotes(files: readonly TurnDiffFile[]): readonly string[] {
  const notes: string[] = [];
  for (const file of files) {
    if (file.binary === true) notes.push(`${file.path}: binary content — not rendered`);
    else if (file.oversize === true) notes.push(`${file.path}: oversize — not rendered`);
  }
  return notes;
}
