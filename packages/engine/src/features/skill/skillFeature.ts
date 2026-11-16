import { ScopeActivation } from '@hilbras/omnicode-base/di/instantiation';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { IActiveSkillGrant } from './enforcement';
import { AgentSkillCuratorService, ISkillCuratorService } from './curator/curatorService';
import { AgentSkillService, IAgentSkillService } from './skillService';

export class SkillFeature extends Feature {
  static override readonly name = 'skill';

  constructor() {
    super();
    this.contributeAgentService(IAgentSkillService, AgentSkillService, {
      activation: ScopeActivation.OnDemand,
    });
    this.contributeAgentService(ISkillCuratorService, AgentSkillCuratorService, {
      activation: ScopeActivation.OnDemand,
    });
    // Same instance under a narrow read-only interface so the request path can
    // narrow its tool list without importing the skill service.
    this.contributeAgentService(IActiveSkillGrant, AgentSkillService, {
      activation: ScopeActivation.OnDemand,
    });
  }
}

registerFeature(SkillFeature);
