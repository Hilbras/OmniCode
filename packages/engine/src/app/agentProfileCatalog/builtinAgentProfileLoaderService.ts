import { IInstantiationService } from '@hilbras/omnicode-base/di/instantiation';
import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { Service } from '@hilbras/omnicode-base/di/service';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { BugIndicatingError } from '#/errors';

import type { AgentProfile } from './agentProfileCatalog';
import { DEFAULT_AGENT_PROFILE_NAME } from './agentProfileCatalog';
import {
  AGENT_PROFILE_SOURCE_PRIORITY,
  AgentProfileContribution,
  type AgentProfileContributionRecord,
} from './agentProfileContribution';
import {
  BUILTIN_AGENT_PROFILE_SOURCE_ID,
  IBuiltinAgentProfileLoader,
} from './builtinAgentProfileLoader';
import { getAgentProfileContributions } from './contribution';

export class BuiltinAgentProfileLoaderService
  extends Disposable
  implements IBuiltinAgentProfileLoader
{
  declare readonly _serviceBrand: undefined;

  private readonly byName: Map<string, AgentProfile>;
  private readonly ordered: readonly AgentProfile[];

  constructor(@IInstantiationService instantiationService: IInstantiationService) {
    super();
    const contributions = getAgentProfileContributions();
    this.ordered = [...contributions];
    this.byName = new Map(this.ordered.map((def) => [def.name, def]));
    this._register(
      instantiationService.createInstance(BuiltinAgentProfileContributionUnit, {
        sourceId: BUILTIN_AGENT_PROFILE_SOURCE_ID,
        priority: AGENT_PROFILE_SOURCE_PRIORITY.builtin,
        contribution: { profiles: this.ordered },
      }),
    );
  }

  get(name: string): AgentProfile | undefined {
    return this.byName.get(name);
  }

  getDefault(): AgentProfile {
    const profile = this.byName.get(DEFAULT_AGENT_PROFILE_NAME);
    if (profile === undefined) {
      throw new BugIndicatingError(
        `Default agent profile "${DEFAULT_AGENT_PROFILE_NAME}" is not registered`,
      );
    }
    return profile;
  }

  list(): readonly AgentProfile[] {
    return this.ordered;
  }
}

class BuiltinAgentProfileContributionUnit extends Service {
  constructor(record: AgentProfileContributionRecord) {
    super();
    this.provide(AgentProfileContribution, record);
  }
}

registerScopedService(
  LifecycleScope.App,
  IBuiltinAgentProfileLoader,
  BuiltinAgentProfileLoaderService,
  ScopeActivation.OnScopeCreated,
  'agentProfileCatalog',
);
