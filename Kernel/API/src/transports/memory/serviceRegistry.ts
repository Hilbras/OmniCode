/**
 * Service name → DI token registry for the in-process dispatcher. Only leaf
 * modules are imported (tokens + types) — never the engine root barrel, so
 * hosting klient in-process does not force the full registration side effects
 * beyond what the host already bootstrapped.
 */

import type { ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import { IAgentCommandService } from '@hilbras/omnicode-engine/agent/command/agentCommand';
import { IAgentContextMemoryService } from '@hilbras/omnicode-engine/agent/contextMemory/contextMemory';
import { IAgentFullCompactionService } from '@hilbras/omnicode-engine/agent/fullCompaction/fullCompaction';
import { IAgentLoopService } from '@hilbras/omnicode-engine/agent/loop/loop';
import { IAgentPromptChannel } from '@hilbras/omnicode-engine/agent/loop/promptChannel';
import { IAgentMcpService } from '@hilbras/omnicode-engine/agent/mcp/mcp';
import { IAgentPermissionModeService } from '@hilbras/omnicode-engine/agent/permissionMode/permissionMode';
import { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import { IAgentRuntimeBindingService } from '@hilbras/omnicode-engine/agent/runtimeBinding/runtimeBinding';
import { IAgentShellCommandService } from '@hilbras/omnicode-engine/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@hilbras/omnicode-engine/agent/task/task';
import { IAuthSummaryService, IOAuthService } from '@hilbras/omnicode-engine/app/auth/auth';
import { IBootstrapService } from '@hilbras/omnicode-engine/app/bootstrap/bootstrap';
import { ICapabilityService } from '@hilbras/omnicode-engine/app/capability/capability';
import { IConfigService } from '@hilbras/omnicode-engine/app/config/config';
import { IConnectorCatalogService } from '@hilbras/omnicode-engine/app/connectors/connectors';
import { IEventService } from '@hilbras/omnicode-engine/app/event/event';
import { IFileService } from '@hilbras/omnicode-engine/app/file/fileService';
import { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';
import { IGitHubService } from '@hilbras/omnicode-engine/app/github/github';
import { IHostFolderBrowser } from '@hilbras/omnicode-engine/app/hostFolderBrowser/hostFolderBrowser';
import { IProviderDiscoveryService } from '@hilbras/omnicode-engine/app/kosongConfig/discovery';
import { IModelsDevImportService } from '@hilbras/omnicode-engine/app/kosongConfig/modelsDevImport';
import { IMcpManagementService } from '@hilbras/omnicode-engine/app/mcpManagement/mcpManagement';
import { IPluginService } from '@hilbras/omnicode-engine/app/plugin/plugin';
import { ISessionIndex } from '@hilbras/omnicode-engine/app/sessionIndex/sessionIndex';
import { ISessionManager } from '@hilbras/omnicode-engine/app/sessionManager/sessionManager';
import { IVercelService } from '@hilbras/omnicode-engine/app/vercel/vercel';
import { IWorkspaceService } from '@hilbras/omnicode-engine/app/workspace/workspace';
import { IAgentPlanService } from '@hilbras/omnicode-engine/features/plan/plan';
import { ISessionSkillCatalog } from '@hilbras/omnicode-engine/features/skill/session/skillCatalog';
import { IModelCatalog } from '@hilbras/omnicode-engine/llm-adapter/model/catalog';
import { IModelService } from '@hilbras/omnicode-engine/llm-adapter/model/model';
import { IProviderService } from '@hilbras/omnicode-engine/llm-adapter/provider/provider';
import { ISessionActivityView } from '@hilbras/omnicode-engine/session/sessionActivity/sessionActivity';
import { ISessionMetadata } from '@hilbras/omnicode-engine/session/sessionMetadata/sessionMetadata';
import { ISessionTitleService } from '@hilbras/omnicode-engine/session/sessionTitle/sessionTitle';
import { ISessionTokenCountingService } from '@hilbras/omnicode-engine/session/tokenCounting/sessionTokenCounting';
import { ISessionUsageService } from '@hilbras/omnicode-engine/session/usage/sessionUsage';
import { IWorkspaceInstanceManager } from '@hilbras/omnicode-engine/workspace/workspaceInstance/workspaceInstanceManager';

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
  connectorCatalogService: IConnectorCatalogService,
  githubService: IGitHubService,
  vercelService: IVercelService,
};

export { IEventService };
