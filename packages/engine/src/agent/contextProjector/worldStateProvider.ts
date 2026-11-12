import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { createDecorator, IInstantiationService } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IEventBus } from '#/app/event/eventBus';
import { CompactionCompleted } from '#/agent/fullCompaction/compactionOps';
import { IAgentGoalService } from '#/features/goal/goalService';
import { IAgentTodoService } from '#/features/todo/todoService';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';

import { WorldStateAssembler } from './worldStateAssembler';

/**
 * Supplies the world-state section for the next request from the agent's real
 * goal and todo state.
 *
 * It is a pull: the request path asks when it needs context, and the assembler
 * returns nothing when the state did not change since the last ask. The
 * baseline survives across turns on purpose — a delta is only meaningful
 * within one rendering lineage — and is reset only when that lineage breaks
 * (compaction).
 */
export interface IAgentWorldStateProvider {
  readonly _serviceBrand: undefined;
  /** Section text for this request, or `undefined` when nothing changed. */
  nextSection(): string | undefined;
  /** Call after compaction so the next request renders the full section. */
  resetAfterCompaction(): void;
}

export const IAgentWorldStateProvider = createDecorator<IAgentWorldStateProvider>(
  'agentWorldStateProvider',
);

export class AgentWorldStateProvider
  extends Disposable
  implements IAgentWorldStateProvider
{
  declare readonly _serviceBrand: undefined;

  private readonly assembler = new WorldStateAssembler();

  constructor(
    @IAgentGoalService private readonly goals: IAgentGoalService,
    @IAgentTodoService private readonly todos: IAgentTodoService,
    @IEventBus eventBus: IEventBus,
    @IInstantiationService instantiation: IInstantiationService,
  ) {
    super();
    // Compaction breaks the rendering lineage: every section after it is full.
    this._register(eventBus.subscribe(CompactionCompleted, () => this.assembler.reset()));
    // Push into the requester lazily: injecting the requester here would cycle.
    try {
      instantiation.invokeFunction((accessor) =>
        accessor.get(IAgentLLMRequesterService).setWorldStateProvider?.(this),
      );
    } catch {
      // No requester in this scope; the section simply stays unbound.
    }
  }

  nextSection(): string | undefined {
    return this.assembler.next({
      goal: this.goals.getGoal().goal,
      todos: this.todos.get(),
    });
  }

  resetAfterCompaction(): void {
    this.assembler.reset();
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentWorldStateProvider,
  AgentWorldStateProvider,
  ScopeActivation.OnDemand,
  'worldState',
);
