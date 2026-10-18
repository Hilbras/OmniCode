import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';
import { AgentCronService, IAgentCronService } from '#/features/cron/cronService';

export class CronFeature extends Feature {
  static override readonly name = 'cron';

  constructor() {
    super();
    this.contributeAgentService(IAgentCronService, AgentCronService);
    
    
    
  }
}

registerFeature(CronFeature);
