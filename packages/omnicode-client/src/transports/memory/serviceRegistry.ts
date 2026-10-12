/**
 * Service name → DI token registry for the in-process dispatcher. Only leaf
 * modules are imported (tokens + types) — never the engine root barrel, so
 * hosting klient in-process does not force the full registration side effects
 * beyond what the host already bootstrapped.
 */

import type { ServiceIdentifier } from '@hilbras/omnicode-core/_base/di/instantiation';
import { ISessionIndex } from '@hilbras/omnicode-core/app/sessionIndex/sessionIndex';
import { IWorkspaceService } from '@hilbras/omnicode-core/app/workspace/workspace';
import { IConfigService } from '@hilbras/omnicode-core/app/config/config';
import { IModelService } from '@hilbras/omnicode-core/llm-adapter/model/model';
import { IModelCatalog } from '@hilbras/omnicode-core/llm-adapter/model/catalog';
import { IProviderDiscoveryService } from '@hilbras/omnicode-core/app/kosongConfig/discovery';
import { IModelsDevImportService } from '@hilbras/omnicode-core/app/kosongConfig/modelsDevImport';
import { IProviderService } from '@hilbras/omnicode-core/llm-adapter/provider/provider';
import {
  IAuthSummaryService,
  IOAuthService,
} from '@hilbras/omnicode-core/app/auth/auth';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import { IPluginService } from '@hilbras/omnicode-core/app/plugin/plugin';
import { ICapabilityService } from '@hilbras/omnicode-core/app/capability/capability';
import { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import { IEventService } from '@hilbras/omnicode-core/app/event/event';
import { IFileService } from '@hilbras/omnicode-core/app/file/fileService';
import { IHostFolderBrowser } from '@hilbras/omnicode-core/app/hostFolderBrowser/hostFolderBrowser';
import { IWorkspaceInstanceManager } from '@hilbras/omnicode-core/workspace/workspaceInstance/workspaceInstanceManager';
import { ISessionManager } from '@hilbras/omnicode-core/app/sessionManager/sessionManager';
import { ISessionMetadata } from '@hilbras/omnicode-core/session/sessionMetadata/sessionMetadata';
import { ISessionSkillCatalog } from '@hilbras/omnicode-core/features/skill/session/skillCatalog';
import { ISessionTitleService } from '@hilbras/omnicode-core/session/sessionTitle/sessionTitle';
import { IAgentLoopService } from '@hilbras/omnicode-core/agent/loop/loop';
import { IAgentPromptChannel } from '@hilbras/omnicode-core/agent/loop/promptChannel';
import { IAgentPermissionModeService } from '@hilbras/omnicode-core/agent/permissionMode/permissionMode';
import { IAgentCommandService } from '@hilbras/omnicode-core/agent/command/agentCommand';
import { IAgentRuntimeBindingService } from '@hilbras/omnicode-core/agent/runtimeBinding/runtimeBinding';
import { IAgentContextMemoryService } from '@hilbras/omnicode-core/agent/contextMemory/contextMemory';
import { ISessionTokenCountingService } from '@hilbras/omnicode-core/session/tokenCounting/sessionTokenCounting';
import { ISessionActivityView } from '@hilbras/omnicode-core/session/sessionActivity/sessionActivity';
import { IAgentPlanService } from '@hilbras/omnicode-core/features/plan/plan';
import { IAgentProfileService } from '@hilbras/omnicode-core/agent/profile/profile';
import { IAgentShellCommandService } from '@hilbras/omnicode-core/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@hilbras/omnicode-core/agent/task/task';
import { ISessionUsageService } from '@hilbras/omnicode-core/session/usage/sessionUsage';
import { IAgentMcpService } from '@hilbras/omnicode-core/agent/mcp/mcp';
import { IAgentFullCompactionService } from '@hilbras/omnicode-core/agent/fullCompaction/fullCompaction';
import { IMcpManagementService } from '@hilbras/omnicode-core/app/mcpManagement/mcpManagement';

/** Wire service name (decorator id string) → token. */
export const serviceTokens: Readonly<Record<string, ServiceIdentifier<unknown>>> = {
  sessionIndex: ISessionIndex,
  workspaceService: IWorkspaceService,
  configService: IConfigService,
  modelService: IModelService,
  modelResolver: IModelCatalog,
  providerDiscovery: IProviderDiscoveryService,
  modelsDevImport: IModelsDevImportService,
  providerService: IProviderService,
  oauthService: IOAuthService,
  authSummaryService: IAuthSummaryService,
  flagService: IFlagService,
  pluginService: IPluginService,
  capabilityService: ICapabilityService,
  hostFolderBrowser: IHostFolderBrowser,
  bootstrapService: IBootstrapService,
  fileService: IFileService,
  workspaceInstanceManager: IWorkspaceInstanceManager,
  sessionManager: ISessionManager,
  sessionMetadata: ISessionMetadata,
  sessionSkillCatalog: ISessionSkillCatalog,
  sessionTitleService: ISessionTitleService,
  agentPromptService: IAgentPromptChannel,
  agentLoopService: IAgentLoopService,
  agentPermissionModeService: IAgentPermissionModeService,
  agentCommandService: IAgentCommandService,
  agentRuntimeBindingService: IAgentRuntimeBindingService,
  agentContextMemoryService: IAgentContextMemoryService,
  agentTokenCountingService: ISessionTokenCountingService,
  sessionActivityView: ISessionActivityView,
  agentShellCommandService: IAgentShellCommandService,
  agentProfileService: IAgentProfileService,
  agentUsageService: ISessionUsageService,
  agentPlanService: IAgentPlanService,
  agentTaskService: IAgentTaskService,
  agentMcpService: IAgentMcpService,
  agentFullCompactionService: IAgentFullCompactionService,
  mcpManagementService: IMcpManagementService,
};

export { IEventService };
