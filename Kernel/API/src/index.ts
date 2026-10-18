/**
 * The Kernel's public surface.
 *
 * Consumers — the CLI, the inspector, and anything else outside the Kernel —
 * import from here and nowhere else. Every package behind it is an
 * implementation detail, so any of them can be split, relocated, or replaced
 * without a consumer edit.
 *
 * Importing this module also activates the packages that register
 * themselves at load time: the SDK's tools and the Addons' features. Nothing
 * downstream needs a side-effect import of its own.
 *
 * ACP is the exception, and is exposed through `loadAcpServer` instead of a
 * static re-export: loading it eagerly would boot the ACP engine on every CLI
 * invocation, which the ACP subcommand deliberately avoids.
 */
export * from '@hilbras/omnicode-sdk';
export * from '@hilbras/omnicode-addons';
export * from '@hilbras/omnicode-tools';

export async function loadAcpServer(): Promise<typeof import('@hilbras/omnicode-acp')> {
  return import('@hilbras/omnicode-acp');
}/**
 * `@hilbras/omnicode-api` public surface — the transport-agnostic client facade
 * over the agent-core-v2 engine. Create a klient with one of the transport
 * entry points (`@hilbras/omnicode-api/ipc` or `/memory`); everything
 * exported here behaves identically regardless of which one carried the
 * bytes.
 */

export type {
  CallOptions,
  EventSourceRef,
  IDisposable,
  KlientChannel,
  ScopeRef,
} from './core/channel.js';
export { RPCError } from './core/errors.js';
export { KlientValidationError, type ValidationPhase } from './core/validation.js';
export {
  createKlientFromChannel,
  type AgentHandle,
  type Klient,
  type KlientOptions,
  type SessionHandle,
} from './core/klient.js';
export type { KlientEvents } from './core/events/hub.js';
export type { Caller, ScopedCaller, ScopedStreamCaller } from './core/facade/global.js';

export type {
  ConfigTargetLiteral,
  FileDownload,
  GlobalAuthFacade,
  GlobalConfigFacade,
  GlobalFacade,
  GlobalFilesFacade,
  GlobalFlagsFacade,
  GlobalHostFsFacade,
  GlobalKosongFacade,
  GlobalMcpFacade,
  GlobalPluginsFacade,
  GlobalSessionsFacade,
  GlobalWorkspacesFacade,
  ImportCustomRegistryOptions,
  ImportCustomRegistryResult,
  KlientEnvInfo,
  ModelCatalogItem,
  OAuthFlowSnapshot,
  OAuthFlowStart,
  OAuthLoginCancelResponse,
  OAuthLogoutResponse,
  ProviderCatalogItem,
  RefreshProviderModelsOptions,
  RefreshProviderModelsResponse,
  SetDefaultModelResponse,
} from './core/facade/global.js';

export type {
  AnonymousProviderInput,
  GenerateEvent,
  GenerateInput,
  GenerateParams,
  ProviderAuth,
  ProviderInput,
} from './core/facade/kosong-types.js';

export type {
  SessionApprovalsFacade,
  SessionFacade,
  SessionInteractionsFacade,
  SessionQuestionsFacade,
  SessionRestoreOptions,
  SessionSkillsFacade,
  SessionStatus,
} from './core/facade/session.js';
export type {
  AgentCommandInfo,
  AgentContextData,
  AgentFacade,
  AgentTaskInfo,
  McpServerEntry,
  PlanData,
  PromptLaunchResult,
  PromptWithSkillsInput,
  PromptWithSkillsResult,
  SetModelResult,
  ShellCommandResult,
  ThinkingLevel,
  UsageStatus,
} from './core/facade/agent.js';

export type {
  CatalogChangedPayload,
  KlientEventName,
  KlientEventPayloads,
  SessionArchivedPayload,
  SessionMetaUpdatedPayload,
} from './contract/global/events.js';
export type { SessionEventPayloads } from './contract/session/events.js';
export type { AgentEventPayloads } from './contract/agent/events.js';

// Wire types re-exported for consumer convenience (type-only; the engine is
// not pulled in at runtime for http consumers).
export type {
  SessionListQuery,
  SessionSummary,
} from '@hilbras/omnicode-core/app/sessionIndex/sessionIndex';
export type { Page } from '@hilbras/omnicode-core/persistence/interface/queryStore';
export type {
  Workspace,
  WorkspaceUpdate,
} from '@hilbras/omnicode-core/app/workspace/workspace';
export type {
  ConfigDiagnostic,
  ConfigInspectValue,
} from '@hilbras/omnicode-core/app/config/config';
export type { ProviderConfig } from '@hilbras/omnicode-core/llm-adapter/provider/provider';
export type { AuthStatus } from '@hilbras/omnicode-core/app/auth/auth';
export type { ExperimentalFeatureState } from '@hilbras/omnicode-core/app/flag/flag';
export type {
  FsBrowseResponse,
  FsHomeResponse,
} from '@hilbras/omnicode-core/app/hostFolderBrowser/hostFolderBrowser';
export type { FileMeta } from '@hilbras/omnicode-core/app/file/fileService';
export type {
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from '@hilbras/omnicode-core/app/plugin/types';
export type {
  AgentMeta,
  SessionMeta,
  SessionMetaPatch,
} from '@hilbras/omnicode-core/session/sessionMetadata/sessionMetadata';
export type {
  ApprovalRequest,
  ApprovalResponse,
} from '@hilbras/omnicode-core/agent/interaction/approval';
export type {
  QuestionRequest,
  QuestionResult,
} from '@hilbras/omnicode-core/agent/interaction/question';
export type {
  Interaction,
  InteractionKind,
} from '@hilbras/omnicode-core/human/interaction/interaction';
export type { SkillSummary } from '@hilbras/omnicode-core/features/skill/catalog/types';
export type {
  GlobalMcpServerConfig,
  McpManagedServer,
  McpServerAuthBeginResult,
  McpServerAuthState,
  McpServerAuthStatus,
  McpServerInspection,
  McpServerLocator,
  McpServerTestResult,
  McpServerTestTarget,
} from '@hilbras/omnicode-core/app/mcpManagement/mcpManagement';
export type { ContentPart } from '@hilbras/omnicode-core/human/llm/message';
export type { PermissionMode } from '@hilbras/omnicode-core/agent/permissionPolicy/types';

export {
  createOmnicodeHarness,
  SDKRpcClientV2,
  type SDKRpcClientV2Options,
} from './requestHandler';
