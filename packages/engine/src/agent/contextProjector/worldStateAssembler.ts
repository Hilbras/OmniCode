import type { GoalSnapshot } from '#/features/goal/types';
import type { TodoItem } from '#/features/todo/todoItem';

import {
  WorldStateTracker,
  renderWorldState,
  type WorldState,
  type WorldStateBaseline,
} from './worldState';

/**
 * Assembles the world-state section the model sees each turn from the state
 * the agent actually holds: its goal and its todo list.
 *
 * Only deltas worth the tokens are emitted. The assembler tracks the baseline
 * itself, so a turn that changed nothing costs nothing, and it never guesses:
 * values it cannot flatten are dropped rather than stringified into prose.
 */
export interface WorldStateAssemblerInput {
  readonly goal: GoalSnapshot | null;
  readonly todos: readonly TodoItem[];
  /** Optional pending-task count from the task service. */
  readonly pendingTasks?: number;
}

/** Long titles are clipped so one runaway objective cannot own the section. */
export const WORLD_STATE_TITLE_MAX_CHARS = 160;

export function assembleWorldState(input: WorldStateAssemblerInput): WorldState {
  const state: Record<string, string | number | boolean | null | readonly string[]> = {};
  state['goal.status'] = input.goal?.status ?? null;
  state['goal.objective'] = input.goal === null ? null : clip(input.goal.objective);
  state['goal.turns_used'] = input.goal?.turnsUsed ?? null;
  state['goal.tokens_used'] = input.goal?.tokensUsed ?? null;

  const counts = { pending: 0, inProgress: 0, completed: 0 };
  for (const todo of input.todos) {
    if (todo.status === 'done') counts.completed += 1;
    else if (todo.status === 'in_progress') counts.inProgress += 1;
    else counts.pending += 1;
  }
  state['todos.pending'] = counts.pending;
  state['todos.in_progress'] = counts.inProgress;
  state['todos.completed'] = counts.completed;
  state['todos.open'] = input.todos
    .filter((todo) => todo.status !== 'done')
    .slice(0, 10)
    .map((todo) => clip(todo.title));

  if (input.pendingTasks !== undefined) state['tasks.pending'] = input.pendingTasks;
  return state;
}

export class WorldStateAssembler {
  private readonly tracker = new WorldStateTracker();

  /** Next section text, or `undefined` when nothing changed since the last turn. */
  next(input: WorldStateAssemblerInput): string | undefined {
    const render = this.tracker.next(assembleWorldState(input));
    if (render.kind === 'delta' && Object.keys(render.delta).length === 0) return undefined;
    return renderWorldState(render);
  }

  /** Restore a durable baseline recorded in a previous process (WS4.4). */
  restoreBaseline(baseline: WorldStateBaseline): void {
    this.tracker.restore(baseline);
  }

  /** Baseline to record after a render, or `undefined` before the first one. */
  currentBaseline(): WorldStateBaseline | undefined {
    return this.tracker.currentBaseline();
  }

  /** Called after compaction so the next turn starts from a full section. */
  reset(): void {
    this.tracker.resetBaseline();
  }
}

function clip(value: string): string {
  return value.length <= WORLD_STATE_TITLE_MAX_CHARS
    ? value
    : `${value.slice(0, WORLD_STATE_TITLE_MAX_CHARS)}…`;
}
