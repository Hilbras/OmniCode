import { describe, expect, it } from 'vitest';

import { CompactionCompleted } from '#/agent/fullCompaction/compactionOps';
import { AgentWorldStateProvider } from '#/agent/contextProjector/worldStateProvider';
import { assembleWorldState } from '#/agent/contextProjector/worldStateAssembler';
import { WorldStateSectionRendered } from '#/agent/contextProjector/worldStateOps';
import type { IAgentGoalService } from '#/features/goal/goalService';
import type { IAgentTodoService } from '#/features/todo/todoService';

type Todo = { title: string; status: 'pending' | 'in_progress' | 'done' };

function provider(
  goalStatus: () => string,
  todos: () => Todo[],
  options: {
    persisted?: { readonly value: Record<string, unknown>; readonly version: number };
    events?: unknown[];
  } = {},
) {
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
  const states = {
    contributeState: () => undefined,
    get: () => options.persisted,
    set: () => undefined,
  } as never;
  const dispatcher = {
    dispatch: (event: unknown) => {
      options.events?.push(event);
      return Promise.resolve();
    },
  } as never;
  const scope = { agentId: 'a1' } as never;
  return new AgentWorldStateProvider(
    scope,
    states,
    dispatcher,
    goals,
    todoService,
    { subscribe: () => ({ dispose() {} }) } as never,
    { invokeFunction: () => undefined } as never,
  );
}

function assembled(status: string, todos: Todo[]): Record<string, unknown> {
  return assembleWorldState({
    goal: {
      goalId: 'g', objective: 'ship', status: status as 'active',
      turnsUsed: 1, tokensUsed: 2, wallClockMs: 3, budget: {},
    } as never,
    todos: todos as never,
  });
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
    let todos: Todo[] = [];
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

  it('resets on CompactionCompleted', () => {
    const handlers: (() => void)[] = [];
    const goals = { getGoal: () => ({ goal: null }) } as unknown as IAgentGoalService;
    const todoService = { get: () => [] } as unknown as IAgentTodoService;
    const bus = {
      subscribe: (cls: unknown, handler: () => void) => {
        if (cls === CompactionCompleted) handlers.push(handler);
        return { dispose() {} };
      },
    } as never;
    const p = new AgentWorldStateProvider(
      { agentId: 'a1' } as never,
      { contributeState: () => undefined, get: () => undefined, set: () => undefined } as never,
      { dispatch: () => Promise.resolve() } as never,
      goals,
      todoService,
      bus,
      { invokeFunction: () => undefined } as never,
    );
    p.nextSection();
    handlers.forEach((handler) => handler());
    expect(p.nextSection()).toContain('## World State\n');
  });

  it('resumes a durable baseline across processes and emits only changed fragments', () => {
    const events: unknown[] = [];
    let status = 'active';
    const p = provider(() => status, () => [], {
      persisted: { value: assembled('active', []), version: 3 },
      events,
    });
    // The restarted process already rendered this baseline: no duplicate section.
    expect(p.nextSection()).toBeUndefined();
    expect(events).toHaveLength(0);

    status = 'paused';
    expect(p.nextSection()).toContain('## World State Changes');
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(WorldStateSectionRendered);
    expect(events[0]).toMatchObject({
      agentId: 'a1', version: 3, baseline: { 'goal.status': 'paused' },
    });
  });
});
