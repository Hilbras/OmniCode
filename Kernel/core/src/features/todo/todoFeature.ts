import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';
import { AgentTodoService, IAgentTodoService } from '#/features/todo/todoService';

export class TodoFeature extends Feature {
  static override readonly name = 'todo';

  constructor() {
    super();
    this.contributeAgentService(IAgentTodoService, AgentTodoService);
  }
}

registerFeature(TodoFeature);
