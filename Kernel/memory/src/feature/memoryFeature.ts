import { ScopeActivation } from '@hilbras/omnicode-core/_base/di/instantiation';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import { LifecycleScope } from '@hilbras/omnicode-core/app/scopes';
import { Feature } from '@hilbras/omnicode-core/features/feature';
import { registerFeature } from '@hilbras/omnicode-core/features/featureRegistry';

import { AgentMemoryContextService, IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import { AgentMemoryInjectionService, IMemoryInjectionService } from '#/context/memoryInjectionService';
import { IMemoryService } from '#/contracts/memoryContract';
import { AppMemoryService } from '#/service/appMemoryService';
import { IMemorySearchTool, MemorySearchTool } from '#/tool/memorySearchTool';

import { MEMORY_FLAG_ID } from './flag';

export class MemoryFeature extends Feature {
  static override readonly name = 'memory';

  constructor() {
    super();
    this.contributeService(LifecycleScope.App, IMemoryService, AppMemoryService, {
      activation: ScopeActivation.OnDemand,
    });
    this.contributeAgentService(IAgentMemoryContextService, AgentMemoryContextService, {
      activation: ScopeActivation.OnDemand,
    });
    this.contributeAgentService(IMemoryInjectionService, AgentMemoryInjectionService, {
      activation: ScopeActivation.OnScopeCreated,
    });
    this.contributeTool(IMemorySearchTool, MemorySearchTool, {
      name: 'memory_search',
      domain: 'memory',
      when: (accessor) => accessor.get(IFlagService).enabled(MEMORY_FLAG_ID),
    });
  }
}

registerFeature(MemoryFeature);