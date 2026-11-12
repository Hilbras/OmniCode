import { describe, expect, it } from 'vitest';

import { AgentWorldStateProvider } from '#/agent/contextProjector/worldStateProvider';
import type { IAgentGoalService } from '#/features/goal/goalService';
import type { IAgentTodoService } from '#/features/todo/todoService';

function provider(goalStatus: () => string, todos: () => { title: string; status: 'pending' | 'in_progress' | 'done' }[]) {
  const goals = {
    getGoal: () => ({
      goal: {
        goalId: 'g',
        objective: 'ship',
        status: goalStatus(),
        turnsUsed: 1,
        tokensUsed: 2,
        wallClockMs: 3,
        budget: {},
      },
    }),
  } as unknown as IAgentGoalService;
  const todoService = { get: todos } as unknown as IAgentTodoService;
  return new AgentWorldStateProvider(goals, todoService);
}

describe('AgentWorldStateProvider', () => {
  it('renders goal and todos from the live services', () => {
    const section = provider(() => 'active', () => [{ title: 'a', status: 'pending' }]).nextSection();
    expect(section).toContain('- goal.status: active');
    expect(section).toContain('- goal.objective: ship');
  });

  it('returns nothing when the state did not change', () => {
    const p = provider(() => 'active', () => []);
    p.nextSection();
    expect(p.nextSection()).toBeUndefined();
  });

  it('renders a delta when only the todo list changes', () => {
    let todos: { title: string; status: 'pending' }[] = [];
    const p = provider(() => 'active', () => todos);
    expect(p.nextSection()).toContain('## World State');
    todos = [{ title: 'b', status: 'pending' }];
    expect(p.nextSection()).toContain('## World State Changes');
  });

  it('renders full again after compaction', () => {
    const p = provider(() => 'active', () => []);
    p.nextSection();
    p.resetAfterCompaction();
    expect(p.nextSection()).toContain('## World State\n');
  });
});
