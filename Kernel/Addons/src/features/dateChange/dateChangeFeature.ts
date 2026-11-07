import { Feature } from '@hilbras/omnicode-engine/features/feature';
import { registerFeature } from '@hilbras/omnicode-engine/features/featureRegistry';
import { AgentDateChangeService, IAgentDateChangeService } from '#/features/dateChange/dateChangeService';

export class DateChangeFeature extends Feature {
  static override readonly name = 'dateChange';

  constructor() {
    super();
    this.contributeAgentService(IAgentDateChangeService, AgentDateChangeService);
  }
}

registerFeature(DateChangeFeature);
