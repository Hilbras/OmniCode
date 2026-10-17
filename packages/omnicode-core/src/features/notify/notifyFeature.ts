import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { AgentNotifyUserNudgeService, IAgentNotifyUserNudgeService } from './notifyUserNudgeService';

export class NotifyFeature extends Feature {
  static override readonly name = 'notify';

  constructor() {
    super();
    this.contributeAgentService(IAgentNotifyUserNudgeService, AgentNotifyUserNudgeService);
  }
}

registerFeature(NotifyFeature);
