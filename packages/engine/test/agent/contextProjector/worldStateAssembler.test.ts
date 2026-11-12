import { describe, expect, it } from 'vitest';

import {
  WORLD_STATE_TITLE_MAX_CHARS,
  WorldStateAssembler,
  assembleWorldState,
} from '#/agent/contextProjector/worldStateAssembler';
import type { GoalSnapshot } from '#/features/goal/types';

function goal(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: 'g1',
    objective: 'ship the parity plan',
    status: 'active',
    turnsUsed: 3,
    tokensUsed: 1200,
    wallClockMs: 1000,
    budget: {} as GoalSnapshot['budget'],
    ...overrides,
  };
}

describe('assembleWorldState', () => {
  it('flattens goal and todo counts', () => {
    const state = assembleWorldState({
      goal: goal(),
      todos: [
        { title: 'a', status: 'done' },
        { title: 'b', status: 'in_progress' },
        { title: 'c', status: 'pending' },
        { title: 'd', status: 'pending' },
      ],
    });
    expect(state).toMatchObject({
      'goal.status': 'active',
      'goal.objective': 'ship the parity plan',
      'goal.turns_used': 3,
      'todos.pending': 2,
      'todos.in_progress': 1,
      'todos.completed': 1,
      'todos.open': ['b', 'c', 'd'],
    });
  });

  it('clears goal keys when there is no goal', () => {
    const state = assembleWorldState({ goal: null, todos: [] });
    expect(state['goal.status']).toBeNull();
    expect(state['goal.objective']).toBeNull();
  });

  it('clips runaway objectives and caps the open list at ten', () => {
    const state = assembleWorldState({
      goal: goal({ objective: 'x'.repeat(1_000) }),
      todos: Array.from({ length: 20 }, (_, index) => ({
        title: `todo ${String(index)}`,
        status: 'pending' as const,
      })),
    });
    expect((state['goal.objective'] as string).length).toBe(WORLD_STATE_TITLE_MAX_CHARS + 1);
    expect(state['todos.open']).toHaveLength(10);
  });
});

describe('WorldStateAssembler', () => {
  it('emits a full section first, a delta on change, and nothing when quiet', () => {
    const assembler = new WorldStateAssembler();
    const open = assembler.next({ goal: goal(), todos: [] });
    expect(open).toContain('## World State');
    expect(open).toContain('- goal.status: active');

    const delta = assembler.next({ goal: goal(), todos: [{ title: 'x', status: 'pending' }] });
    expect(delta).toContain('## World State Changes');
    expect(delta).toContain('todos.pending');

    expect(assembler.next({ goal: goal(), todos: [{ title: 'x', status: 'pending' }] })).toBeUndefined();
  });

  it('is full again after reset (compaction)', () => {
    const assembler = new WorldStateAssembler();
    assembler.next({ goal: goal(), todos: [] });
    assembler.next({ goal: goal({ turnsUsed: 4 }), todos: [] });
    assembler.reset();
    expect(assembler.next({ goal: goal({ turnsUsed: 4 }), todos: [] })).toContain('## World State\n');
  });
});
