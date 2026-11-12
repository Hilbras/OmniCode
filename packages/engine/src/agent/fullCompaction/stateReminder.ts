/**
 * Post-compaction state reminder.
 *
 * The compaction summary is written by the model itself, so the durable state
 * it held outside the conversation — its goal, its todo counts, the background
 * tasks it left running — can survive the summary imperfectly. This module
 * renders that state back as a short reminder, bounded so it cannot recreate
 * the bulk compaction just removed.
 *
 * Agent-controlled text (the goal objective) is collapsed to a single line
 * before rendering so it cannot forge headings inside the recovery footer.
 */

export const POST_COMPACTION_STATE_HEADING = '## State at Compaction';

/** Long objectives are clipped so one runaway goal cannot own the section. */
export const STATE_OBJECTIVE_MAX_CHARS = 160;
/** Characters kept for the whole section before a visible truncation marker. */
export const STATE_SECTION_MAX_CHARS = 2_000;

export interface StateReminderGoal {
  readonly status: string;
  readonly objective: string;
  readonly turnsUsed?: number;
}

export interface StateReminderTodo {
  readonly status: 'pending' | 'in_progress' | 'done';
}

export interface StateReminderInput {
  readonly goal: StateReminderGoal | null;
  readonly todos: readonly StateReminderTodo[];
  readonly activeTasks: readonly unknown[];
  readonly maxSectionChars?: number;
}

export function renderStateReminder(input: StateReminderInput): string | undefined {
  const maxSectionChars = positiveOrDefault(input.maxSectionChars, STATE_SECTION_MAX_CHARS);
  const lines: string[] = [];

  if (input.goal !== null) {
    const turnsUsed = input.goal.turnsUsed;
    const turnsNote =
      turnsUsed !== undefined && turnsUsed > 0 ? ` — ${String(turnsUsed)} turn(s) used` : '';
    lines.push(
      `- Goal (${input.goal.status}): ${oneLine(input.goal.objective, STATE_OBJECTIVE_MAX_CHARS)}${turnsNote}`,
    );
  }

  const counts = todoCounts(input.todos);
  if (counts.total > 0) {
    lines.push(
      `- Todos: ${String(counts.pending)} pending, ${String(counts.inProgress)} in progress, ${String(counts.done)} done (the TODO List above is still current)`,
    );
  }

  if (input.activeTasks.length > 0) {
    lines.push(`- Background tasks: ${String(input.activeTasks.length)} still running`);
  }

  if (lines.length === 0) return undefined;
  const text = [POST_COMPACTION_STATE_HEADING, ...lines].join('\n');
  if (text.length <= maxSectionChars) return text;
  return `${text.slice(0, maxSectionChars)}\n(state reminder truncated)`;
}

function todoCounts(todos: readonly StateReminderTodo[]): {
  readonly pending: number;
  readonly inProgress: number;
  readonly done: number;
  readonly total: number;
} {
  let pending = 0;
  let inProgress = 0;
  let done = 0;
  for (const todo of todos) {
    if (todo.status === 'pending') pending += 1;
    else if (todo.status === 'in_progress') inProgress += 1;
    else done += 1;
  }
  return { pending, inProgress, done, total: pending + inProgress + done };
}

/** Collapses newlines and clips, so the value cannot start a markdown line. */
function oneLine(value: string, maxChars: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars)}…`;
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}
