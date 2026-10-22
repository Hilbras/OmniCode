/**
 * Service name → DI token registry for the in-process dispatcher. Only leaf
 * modules are imported (tokens + types) — never the engine root barrel, so
 * hosting klient in-process does not force the full registration side effects
 * beyond what the host already bootstrapped.
 */

import type { ServiceIdentifier } from '@hilbras/omnicode-core/_base/di/instantiation';
import { IAgentCommandService } from '@hilbras/omnicode-core/agent/command/agentCommand';
import { IAgentContextMemoryService } from '@hilbras/omnicode-core/agent/contextMemory/contextMemory';
import { IAgentFullCompactionService } from '@hilbras/omnicode-core/agent/fullCompaction/fullCompaction';
import { IAgentLoopService } from '@hilbras/omnicode-core/agent/loop/loop';
import { IAgentPromptChannel } from '@hilbras/omnicode-core/agent/loop/promptChannel';
import { IAgentMcpService } from '@hilbras/omnicode-core/agent/mcp/mcp';
import { IAgentPermissionModeService } from '@hilbras/omnicode-core/agent/permissionMode/permissionMode';
import { IAgentProfileService } from '@hilbras/omnicode-core/agent/profile/profile';
import { IAgentRuntimeBindingService } from '@hilbras/omnicode-core/agent/runtimeBinding/runtimeBinding';
import { IAgentShellCommandService } from '@hilbras/omnicode-core/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@hilbras/omnicode-core/agent/task/task';
import { IAuthSummaryService, IOAuthService } from '@hilbras/omnicode-core/app/auth/auth';
import { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import { ICapabilityService } from '@hilbras/omnicode-core/app/capability/capability';
import { IConfigService } from '@hilbras/omnicode-core/app/config/config';
import { IConnectorCatalogService } from '@hilbras/omnicode-core/app/connectors/connectors';
import { IEventService } from '@hilbras/omnicode-core/app/event/event';
import { IFileService } from '@hilbras/omnicode-core/app/file/fileService';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import { IGitHubService } from '@hilbras/omnicode-core/app/github/github';
import { IHostFolderBrowser } from '@hilbras/omnicode-core/app/hostFolderBrowser/hostFolderBrowser';
import { IProviderDiscoveryService } from '@hilbras/omnicode-core/app/kosongConfig/discovery';
import { IModelsDevImportService } from '@hilbras/omnicode-core/app/kosongConfig/modelsDevImport';
import { IMcpManagementService } from '@hilbras/omnicode-core/app/mcpManagement/mcpManagement';
import { IPluginService } from '@hilbras/omnicode-core/app/plugin/plugin';
import { ISessionIndex } from '@hilbras/omnicode-core/app/sessionIndex/sessionIndex';
import { ISessionManager } from '@hilbras/omnicode-core/app/sessionManager/sessionManager';
import { IVercelService } from '@hilbras/omnicode-core/app/vercel/vercel';
import { IWorkspaceService } from '@hilbras/omnicode-core/app/workspace/workspace';
import { IAgentPlanService } from '@hilbras/omnicode-core/features/plan/plan';
import { ISessionSkillCatalog } from '@hilbras/omnicode-core/features/skill/session/skillCatalog';
import { IModelCatalog } from '@hilbras/omnicode-core/llm-adapter/model/catalog';
import { IModelService } from '@hilbras/omnicode-core/llm-adapter/model/model';
import { IProviderService } from '@hilbras/omnicode-core/llm-adapter/provider/provider';
import { ISessionActivityView } from '@hilbras/omnicode-core/session/sessionActivity/sessionActivity';
import { ISessionMetadata } from '@hilbras/omnicode-core/session/sessionMetadata/sessionMetadata';
import { ISessionTitleService } from '@hilbras/omnicode-core/session/sessionTitle/sessionTitle';
import { ISessionTokenCountingService } from '@hilbras/omnicode-core/session/tokenCounting/sessionTokenCounting';
import { ISessionUsageService } from '@hilbras/omnicode-core/session/usage/sessionUsage';
import { IWorkspaceInstanceManager } from '@hilbras/omnicode-core/workspace/workspaceInstance/workspaceInstanceManager';

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
