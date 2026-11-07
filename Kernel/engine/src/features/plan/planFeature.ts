import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import './configSection';
import { IAgentPlanService } from './plan';
import { AgentPlanService } from './planService';

export class PlanFeature extends Feature {
  static override readonly name = 'plan';

  constructor() {
    super();
    this.contributeAgentService(IAgentPlanService, AgentPlanService);
    
    
  }
}

registerFeature(PlanFeature);
