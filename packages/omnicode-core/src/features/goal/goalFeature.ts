import { ScopeActivation } from '#/_base/di/instantiation';
import { LifecycleScope } from '#/app/scopes';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { IGoalDeadlineScheduler } from './goalDeadlineScheduler';
import { GoalDeadlineSchedulerService } from './goalDeadlineSchedulerService';
import { AgentGoalService, IAgentGoalService } from './goalService';

export class GoalFeature extends Feature {
  static override readonly name = 'goal';

  constructor() {
    super();
    this.contributeAgentService(IAgentGoalService, AgentGoalService);
    this.contributeService(LifecycleScope.App, IGoalDeadlineScheduler, GoalDeadlineSchedulerService, {
      activation: ScopeActivation.OnDemand,
    });
    
    
    
    
  }
}

registerFeature(GoalFeature);
