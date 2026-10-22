/**
 * Compile-time parity checks between klient wire schemas and the engine
 * types they mirror. Plain `.ts` (not `.test.ts`) — vitest must not pick it
 * up; `tsc -p tsconfig.json --noEmit` is the check.
 *
 * Wire shapes are reached through indexed access on the engine service
 * interfaces, so klient needs no direct dependency for most of them.
 */

import type { ISessionScopeHandle } from '@hilbras/omnicode-core/_base/di/scope';
import type { IAgentCommandService } from '@hilbras/omnicode-core/agent/command/agentCommand';
import type { AgentContextData } from '@hilbras/omnicode-core/agent/contextMemory/types';
import type {
  CompactionBlockedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
  CompactionStartedEvent,
} from '@hilbras/omnicode-core/agent/fullCompaction/compactionOps';
import type { FullCompactionInput } from '@hilbras/omnicode-core/agent/fullCompaction/fullCompaction';
import type {
  ApprovalRequest,
  ApprovalResponse,
} from '@hilbras/omnicode-core/agent/interaction/approval';
import type {
  QuestionAnswers,
  QuestionItem,
  QuestionOption,
  QuestionRequest,
  QuestionResponse,
  QuestionResult,
} from '@hilbras/omnicode-core/agent/interaction/question';
import type {
  PromptLaunchResult,
  PromptPayload,
  SteerPayload,
} from '@hilbras/omnicode-core/agent/loop/loop';
import type { TurnEndReason } from '@hilbras/omnicode-core/agent/loop/turnEvents';
import type {
  AssistantDeltaEvent,
  ThinkingDeltaEvent,
  TurnStartedEvent,
} from '@hilbras/omnicode-core/agent/loop/turnEvents';
import type { TurnEndedEvent } from '@hilbras/omnicode-core/agent/loop/turnOps';
import type { PermissionMode } from '@hilbras/omnicode-core/agent/permissionPolicy/types';
import type { IAgentProfileService } from '@hilbras/omnicode-core/agent/profile/profile';
import type {
  PromptAbortedEvent,
  PromptCompletedEvent,
} from '@hilbras/omnicode-core/agent/prompt/promptEvents';
import type { IAgentRuntimeBindingService } from '@hilbras/omnicode-core/agent/runtimeBinding/runtimeBinding';
import type { IAgentShellCommandService } from '@hilbras/omnicode-core/agent/shellCommand/shellCommand';
import type { TaskInfo } from '@hilbras/omnicode-core/agent/task/types';
import type {
  ToolCallDeltaEvent,
  ToolCallStartedEvent,
  ToolProgressEvent,
} from '@hilbras/omnicode-core/agent/toolExecutor/toolExecutorEvents';
import type { UsageStatus } from '@hilbras/omnicode-core/agent/usage/usage';
import type { AuthStatus, IOAuthService } from '@hilbras/omnicode-core/app/auth/auth';
import type { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import type {
  CapabilityInstallProgress,
  CapabilityStatus,
  CapabilityStep,
} from '@hilbras/omnicode-core/app/capability/types';
import type {
  ConfigDiagnostic,
  ConfigInspectValue,
  ConfigTarget,
} from '@hilbras/omnicode-core/app/config/config';
import type {
  ConnectorAction,
  ConnectorCapability,
  ConnectorEntry,
  ConnectorKind,
  ConnectorScope,
  ConnectorStatus,
} from '@hilbras/omnicode-core/app/connectors/connectors';
import type { FileMeta, SaveOptions } from '@hilbras/omnicode-core/app/file/fileService';
import type { ExperimentalFeatureState } from '@hilbras/omnicode-core/app/flag/flag';
import type {
  GitHubConnectResult,
  GitHubConnectionStatus,
  GitHubDeviceFlowStart,
  GitHubDisconnectResult,
} from '@hilbras/omnicode-core/app/github/types';
import type {
  FsBrowseResponse,
  FsHomeResponse,
} from '@hilbras/omnicode-core/app/hostFolderBrowser/hostFolderBrowser';
import type { IProviderDiscoveryService } from '@hilbras/omnicode-core/app/kosongConfig/discovery';
import type {
  ImportCustomRegistryOptions,
  ImportCustomRegistryResult,
} from '@hilbras/omnicode-core/app/kosongConfig/modelsDevImport';
import type {
  GlobalMcpServerConfig,
  McpAuthStatusQuery,
  McpManagedServer,
  McpServerAuthBeginResult,
  McpServerAuthFlowHandle,
  McpServerAuthState,
  McpServerAuthStatus,
  McpServerInspection,
  McpServerLocator,
  McpServerTestResult,
  McpServerTestTarget,
} from '@hilbras/omnicode-core/app/mcpManagement/mcpManagement';
import type {
  McpRegistryPluginOrigin,
  McpRegistryQuery,
  McpServerSource,
} from '@hilbras/omnicode-core/app/mcpRegistry/mcpRegistry';
import type {
  GetPluginInfoInput,
  InstallPluginInput,
  RemovePluginInput,
  SetPluginEnabledInput,
  SetPluginMcpServerEnabledInput,
} from '@hilbras/omnicode-core/app/plugin/plugin';
import type {
  PluginCommandDef,
  PluginDiagnostic,
  PluginGithubMetadata,
  PluginInfo,
  PluginManifest,
  PluginMcpServerInfo,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from '@hilbras/omnicode-core/app/plugin/types';
import type {
  SessionListQuery,
  SessionSummary,
} from '@hilbras/omnicode-core/app/sessionIndex/sessionIndex';
import type { Workspace, WorkspaceUpdate } from '@hilbras/omnicode-core/app/workspace/workspace';
import type { WarningEvent } from '@hilbras/omnicode-core/errors';
// Test-only: the v1 wire event types now live in agent-core-v2; importing
// them here (never in `src/`) strengthens parity for the agent event stream.
import type { ToolResultEvent } from '@hilbras/omnicode-core/events';
import type { PlanData } from '@hilbras/omnicode-core/features/plan/plan';
import type { SkillSummary } from '@hilbras/omnicode-core/features/skill/catalog/types';
import type { IAgentSkillService } from '@hilbras/omnicode-core/features/skill/skillService';
import type {
  Interaction,
  InteractionResolution,
} from '@hilbras/omnicode-core/human/interaction/interaction';
import type { ContentPart } from '@hilbras/omnicode-core/human/llm/message';
import type { IModelCatalog } from '@hilbras/omnicode-core/llm-adapter/model/catalog';
import type { ModelRecord } from '@hilbras/omnicode-core/llm-adapter/model/model';
import type { ProviderConfig } from '@hilbras/omnicode-core/llm-adapter/provider/provider';
import type { McpServerConfig } from '@hilbras/omnicode-core/mcpCore/config-schema';
import type { McpServerConfigView } from '@hilbras/omnicode-core/mcpCore/configView';
import type { McpServerEntry } from '@hilbras/omnicode-core/mcpCore/connection-manager';
import type { SessionActivityState } from '@hilbras/omnicode-core/session/sessionActivity/sessionActivity';
import type {
  AgentMeta,
  SessionMeta,
  SessionMetadataChangedEvent,
  SessionMetaPatch,
} from '@hilbras/omnicode-core/session/sessionMetadata/sessionMetadata';
import type { ISessionTitleService } from '@hilbras/omnicode-core/session/sessionTitle/sessionTitle';
import type {
  CreateChildSessionOptions,
  CreateSessionOptions,
  ForkSessionOptions,
  ResumeSessionOptions,
} from '@hilbras/omnicode-core/workspace/sessionLifecycle/sessionLifecycle';
import type { z } from 'zod';

import {
  assistantDeltaEventSchema,
  compactionBlockedEventSchema,
  compactionCancelledEventSchema,
  compactionCompletedEventSchema,
  compactionStartedEventSchema,
  promptAbortedEventSchema,
  promptCompletedEventSchema,
  thinkingDeltaEventSchema,
  toolCallDeltaEventSchema,
  toolCallStartedEventSchema,
  toolProgressEventSchema,
  toolResultEventSchema,
  turnEndedEventSchema,
  turnStartedEventSchema,
  warningEventSchema,
} from '../src/contract/agent/events.js';
import {
  agentCommandInfoSchema,
  agentContextDataSchema,
  agentTaskInfoSchema,
  activateSkillPayloadSchema,
  cancelPayloadSchema,
  cancelPlanPayloadSchema,
  cancelShellCommandPayloadSchema,
  emptyPayloadSchema,
  getTaskOutputPayloadSchema,
  getTasksPayloadSchema,
  planDataSchema,
  promptLaunchResultSchema,
  promptPartSchema,
  promptPayloadSchema,
  promptSkillActivationSchema,
  promptWithSkillsPayloadSchema,
  promptWithSkillsResultSchema,
  runCommandPayloadSchema,
  runShellCommandPayloadSchema,
  runtimeBindingSchema,
  setModelPayloadSchema,
  setModelResultSchema,
  setPermissionPayloadSchema,
  shellCommandResultSchema,
  steerPayloadSchema,
  stopTaskPayloadSchema,
  tokenUsageSchema,
  usageStatusSchema,
} from '../src/contract/agent/schemas.js';
import { fullCompactionInputSchema, mcpServerEntrySchema } from '../src/contract/agent/services.js';
import {
  authStatusSchema,
  oAuthFlowSnapshotSchema,
  oAuthFlowStartSchema,
  oAuthLoginCancelResponseSchema,
  oAuthLogoutResponseSchema,
  refreshOAuthProviderModelsResponseSchema,
} from '../src/contract/global/auth.js';
import {
  capabilityInstallProgressSchema,
  capabilityStatusSchema,
  capabilityStepSchema,
} from '../src/contract/global/capabilities.js';
import {
  modelCatalogItemSchema,
  providerCatalogItemSchema,
  setDefaultModelResponseSchema,
} from '../src/contract/global/catalog.js';
import {
  configDiagnosticSchema,
  configInspectValueSchema,
  configTargetSchema,
} from '../src/contract/global/config.js';
import {
  connectorActionSchema,
  connectorCapabilitySchema,
  connectorEntrySchema,
  connectorKindSchema,
  connectorScopeSchema,
  connectorStatusSchema,
} from '../src/contract/global/connectors.js';
import { fileMetaSchema, fileSaveOptionsSchema } from '../src/contract/global/files.js';
import { experimentalFeatureStateSchema } from '../src/contract/global/flags.js';
import {
  githubConnectResultSchema,
  githubConnectionStatusSchema,
  githubDeviceFlowStartSchema,
  githubDisconnectResultSchema,
} from '../src/contract/global/github.js';
import { fsBrowseResponseSchema, fsHomeResponseSchema } from '../src/contract/global/hostFs.js';
import {
  globalMcpServerConfigSchema,
  mcpAuthStatusQuerySchema,
  mcpManagedServerSchema,
  mcpRegistryPluginOriginSchema,
  mcpRegistryQuerySchema,
  mcpServerAuthBeginResultSchema,
  mcpServerAuthFlowHandleSchema,
  mcpServerAuthStateSchema,
  mcpServerAuthStatusSchema,
  mcpServerConfigDataSchema,
  mcpServerInspectionSchema,
  mcpServerLocatorSchema,
  mcpServerSourceSchema,
  mcpServerTestResultSchema,
  mcpServerTestTargetSchema,
} from '../src/contract/global/mcpManagement.js';
import { modelConfigSchema } from '../src/contract/global/models.js';
import {
  getPluginInfoInputSchema,
  installPluginInputSchema,
  pluginCommandDefSchema,
  pluginDiagnosticSchema,
  pluginGithubMetadataSchema,
  pluginInfoSchema,
  pluginManifestSchema,
  pluginMcpServerInfoSchema,
  pluginSummarySchema,
  pluginUpdateStatusSchema,
  reloadSummarySchema,
  removePluginInputSchema,
  setPluginEnabledInputSchema,
  setPluginMcpServerEnabledInputSchema,
} from '../src/contract/global/plugins.js';
import {
  refreshProviderModelsOptionsSchema,
  refreshProviderModelsResponseSchema,
} from '../src/contract/global/providerDiscovery.js';
import { providerConfigSchema } from '../src/contract/global/providers.js';
import {
  importCustomRegistryOptionsSchema,
  importCustomRegistryResultSchema,
} from '../src/contract/global/registryImport.js';
import { sessionListQuerySchema, sessionSummarySchema } from '../src/contract/global/sessions.js';
import { workspaceSchema, workspaceUpdateSchema } from '../src/contract/global/workspaces.js';
import { sessionActivityStateSchema } from '../src/contract/session/activity.js';
import { approvalRequestSchema, approvalResponseSchema } from '../src/contract/session/approval.js';
import {
  interactionResolutionSchema,
  interactionSchema,
} from '../src/contract/session/interaction.js';
import {
  createChildSessionOptionsSchema,
  createSessionOptionsSchema,
  forkSessionOptionsSchema,
  handleWireSchema,
  resumeSessionOptionsSchema,
} from '../src/contract/session/lifecycle.js';
import {
  agentMetaSchema,
  sessionMetaPatchSchema,
  sessionMetaSchema,
  sessionMetadataChangedEventSchema,
} from '../src/contract/session/metadata.js';
import {
  questionAnswersSchema,
  questionItemSchema,
  questionOptionSchema,
  questionRequestSchema,
  questionResponseSchema,
  questionResultSchema,
} from '../src/contract/session/question.js';
import { skillSummarySchema } from '../src/contract/session/skills.js';
import { sessionTitleContract } from '../src/contract/session/title.js';
import type { AgentFacade } from '../src/core/facade/agent.js';
import type { AssertWire, MutableDeep } from './helpers/typeAssert.js';

/** One-directional: the engine type must be assignable TO the schema's infer. */
type AssertEngineToWire<TSchema extends z.ZodType, TEngine> = [MutableDeep<TEngine>] extends [
  z.infer<TSchema>,
]
  ? true
  : never;

/** One-directional: the schema's infer must be assignable TO the engine type. */
type AssertWireToEngine<TSchema extends z.ZodType, TEngine> = [z.infer<TSchema>] extends [
  MutableDeep<TEngine>,
]
  ? true
  : never;

const _registryImportOptions: AssertWire<
  typeof importCustomRegistryOptionsSchema,
  ImportCustomRegistryOptions
> = true;
const _registryImportResult: AssertWire<
  typeof importCustomRegistryResultSchema,
  ImportCustomRegistryResult
> = true;

// Wire shapes, derived from the engine interfaces.
type OAuthFlowStart = Awaited<ReturnType<IOAuthService['startLogin']>>;
type OAuthFlowSnapshot = NonNullable<ReturnType<IOAuthService['getFlow']>>;
type OAuthLoginCancelResponse = Awaited<ReturnType<IOAuthService['cancelLogin']>>;
type OAuthLogoutResponse = Awaited<ReturnType<IOAuthService['logout']>>;
type RefreshOAuthProviderModelsResponse = Awaited<
  ReturnType<IOAuthService['refreshOAuthProviderModels']>
>;
/** String-enum value union (`'user' | 'memory'`). */
type ConfigTargetValues = `${ConfigTarget}`;

// sessions.ts
const _sessionSummary: AssertWire<typeof sessionSummarySchema, SessionSummary> = true;
const _sessionListQuery: AssertWire<typeof sessionListQuerySchema, SessionListQuery> = true;

// workspaces.ts
const _workspace: AssertWire<typeof workspaceSchema, Workspace> = true;
const _workspaceUpdate: AssertWire<typeof workspaceUpdateSchema, WorkspaceUpdate> = true;

// config.ts
// One-directional: the engine declares the `ConfigInspectValue` keys as
// required with `| undefined` values, while the wire schema marks them
// `.optional()`; optional → required is not assignable, so only the
// engine → wire direction holds.
const _configInspectValue: AssertEngineToWire<typeof configInspectValueSchema, ConfigInspectValue> =
  true;
const _configDiagnostic: AssertWire<typeof configDiagnosticSchema, ConfigDiagnostic> = true;
const _configTarget: AssertWire<typeof configTargetSchema, ConfigTargetValues> = true;

// capabilities.ts
const _capabilityStep: AssertWire<typeof capabilityStepSchema, CapabilityStep> = true;
const _capabilityInstallProgress: AssertWire<
  typeof capabilityInstallProgressSchema,
  CapabilityInstallProgress
> = true;
const _capabilityStatus: AssertWire<typeof capabilityStatusSchema, CapabilityStatus> = true;

// providers.ts
const _providerConfig: AssertWire<typeof providerConfigSchema, ProviderConfig> = true;

// auth.ts
const _oAuthFlowStart: AssertWire<typeof oAuthFlowStartSchema, OAuthFlowStart> = true;
const _oAuthFlowSnapshot: AssertWire<typeof oAuthFlowSnapshotSchema, OAuthFlowSnapshot> = true;
const _oAuthLoginCancelResponse: AssertWire<
  typeof oAuthLoginCancelResponseSchema,
  OAuthLoginCancelResponse
> = true;
const _oAuthLogoutResponse: AssertWire<typeof oAuthLogoutResponseSchema, OAuthLogoutResponse> =
  true;
const _authStatus: AssertWire<typeof authStatusSchema, AuthStatus> = true;
const _refreshOAuthProviderModelsResponse: AssertWire<
  typeof refreshOAuthProviderModelsResponseSchema,
  RefreshOAuthProviderModelsResponse
> = true;

// flags.ts
const _experimentalFeatureState: AssertWire<
  typeof experimentalFeatureStateSchema,
  ExperimentalFeatureState
> = true;

// hostFs.ts
const _fsBrowseResponse: AssertWire<typeof fsBrowseResponseSchema, FsBrowseResponse> = true;
const _fsHomeResponse: AssertWire<typeof fsHomeResponseSchema, FsHomeResponse> = true;

// files.ts (`fileGetResultSchema` has no engine counterpart — the wire
// adaptation replaces `GetResult.stream` with base64 `data`).
const _fileMeta: AssertWire<typeof fileMetaSchema, FileMeta> = true;
const _fileSaveOptions: AssertWire<typeof fileSaveOptionsSchema, SaveOptions> = true;

// catalog.ts / providerDiscovery.ts — protocol wire shapes derived through the
// catalog and discovery service interfaces.
type ModelCatalogItem = Awaited<ReturnType<IModelCatalog['listModels']>>[number];
type ProviderCatalogItem = Awaited<ReturnType<IModelCatalog['listProviders']>>[number];
type SetDefaultModelResponse = Awaited<ReturnType<IModelCatalog['setDefaultModel']>>;
type RefreshProviderModelsOptions = NonNullable<
  Parameters<IProviderDiscoveryService['refreshProviderModels']>[0]
>;
type RefreshProviderModelsResponse = Awaited<
  ReturnType<IProviderDiscoveryService['refreshProviderModels']>
>;
const _modelCatalogItem: AssertWire<typeof modelCatalogItemSchema, ModelCatalogItem> = true;
const _providerCatalogItem: AssertWire<typeof providerCatalogItemSchema, ProviderCatalogItem> =
  true;
const _setDefaultModelResponse: AssertWire<
  typeof setDefaultModelResponseSchema,
  SetDefaultModelResponse
> = true;
const _refreshProviderModelsOptions: AssertWire<
  typeof refreshProviderModelsOptionsSchema,
  RefreshProviderModelsOptions
> = true;
const _refreshProviderModelsResponse: AssertWire<
  typeof refreshProviderModelsResponseSchema,
  RefreshProviderModelsResponse
> = true;

// models.ts
const _modelConfig: AssertWire<typeof modelConfigSchema, ModelRecord> = true;

// plugins.ts
const _pluginSummary: AssertWire<typeof pluginSummarySchema, PluginSummary> = true;
const _pluginInfo: AssertWire<typeof pluginInfoSchema, PluginInfo> = true;
const _pluginManifest: AssertWire<typeof pluginManifestSchema, PluginManifest> = true;
const _pluginMcpServerInfo: AssertWire<typeof pluginMcpServerInfoSchema, PluginMcpServerInfo> =
  true;
const _pluginDiagnostic: AssertWire<typeof pluginDiagnosticSchema, PluginDiagnostic> = true;
const _pluginGithubMetadata: AssertWire<typeof pluginGithubMetadataSchema, PluginGithubMetadata> =
  true;
const _reloadSummary: AssertWire<typeof reloadSummarySchema, ReloadSummary> = true;
const _pluginUpdateStatus: AssertWire<typeof pluginUpdateStatusSchema, PluginUpdateStatus> = true;
const _pluginCommandDef: AssertWire<typeof pluginCommandDefSchema, PluginCommandDef> = true;
const _installPluginInput: AssertWire<typeof installPluginInputSchema, InstallPluginInput> = true;
const _setPluginEnabledInput: AssertWire<
  typeof setPluginEnabledInputSchema,
  SetPluginEnabledInput
> = true;
const _setPluginMcpServerEnabledInput: AssertWire<
  typeof setPluginMcpServerEnabledInputSchema,
  SetPluginMcpServerEnabledInput
> = true;
const _removePluginInput: AssertWire<typeof removePluginInputSchema, RemovePluginInput> = true;
const _getPluginInfoInput: AssertWire<typeof getPluginInfoInputSchema, GetPluginInfoInput> = true;

// global/mcpManagement.ts — the `McpServerConfig | McpServerConfigView` union
// a managed server's `config` carries (full for mutable entries, redacted for
// read-only ones) is mirrored by one schema covering both shapes; the
// inspection's `config` is always the redacted view, and both assignability
// directions hold against either engine type.
const _mcpServerSource: AssertWire<typeof mcpServerSourceSchema, McpServerSource> = true;
const _mcpRegistryPluginOrigin: AssertWire<
  typeof mcpRegistryPluginOriginSchema,
  McpRegistryPluginOrigin
> = true;
const _mcpRegistryQuery: AssertWire<typeof mcpRegistryQuerySchema, McpRegistryQuery> = true;
const _mcpAuthStatusQuery: AssertWire<typeof mcpAuthStatusQuerySchema, McpAuthStatusQuery> = true;
const _globalMcpServerConfig: AssertWire<
  typeof globalMcpServerConfigSchema,
  GlobalMcpServerConfig
> = true;
const _mcpServerConfigData: AssertWire<
  typeof mcpServerConfigDataSchema,
  McpServerConfig | McpServerConfigView
> = true;
const _mcpServerConfigViewData: AssertWire<typeof mcpServerConfigDataSchema, McpServerConfigView> =
  true;
const _mcpManagedServer: AssertWire<typeof mcpManagedServerSchema, McpManagedServer> = true;
const _mcpServerTestTarget: AssertWire<typeof mcpServerTestTargetSchema, McpServerTestTarget> =
  true;
const _mcpServerTestResult: AssertWire<typeof mcpServerTestResultSchema, McpServerTestResult> =
  true;
const _mcpServerLocator: AssertWire<typeof mcpServerLocatorSchema, McpServerLocator> = true;
const _mcpServerAuthState: AssertWire<typeof mcpServerAuthStateSchema, McpServerAuthState> = true;
const _mcpServerInspection: AssertWire<typeof mcpServerInspectionSchema, McpServerInspection> =
  true;
const _mcpServerAuthStatus: AssertWire<typeof mcpServerAuthStatusSchema, McpServerAuthStatus> =
  true;
const _mcpServerAuthBeginResult: AssertWire<
  typeof mcpServerAuthBeginResultSchema,
  McpServerAuthBeginResult
> = true;
const _mcpServerAuthFlowHandle: AssertWire<
  typeof mcpServerAuthFlowHandleSchema,
  McpServerAuthFlowHandle
> = true;

// global/connectors.ts
const _connectorKind: AssertWire<typeof connectorKindSchema, ConnectorKind> = true;
const _connectorScope: AssertWire<typeof connectorScopeSchema, ConnectorScope> = true;
const _connectorStatus: AssertWire<typeof connectorStatusSchema, ConnectorStatus> = true;
const _connectorCapability: AssertWire<typeof connectorCapabilitySchema, ConnectorCapability> =
  true;
const _connectorAction: AssertWire<typeof connectorActionSchema, ConnectorAction> = true;
const _connectorEntry: AssertWire<typeof connectorEntrySchema, ConnectorEntry> = true;
const _githubConnectionStatus: AssertWire<
  typeof githubConnectionStatusSchema,
  GitHubConnectionStatus
> = true;
const _githubDeviceFlowStart: AssertWire<
  typeof githubDeviceFlowStartSchema,
  GitHubDeviceFlowStart
> = true;
const _githubConnectResult: AssertWire<typeof githubConnectResultSchema, GitHubConnectResult> =
  true;
const _githubDisconnectResult: AssertWire<
  typeof githubDisconnectResultSchema,
  GitHubDisconnectResult
> = true;

// env.ts has no named schemas; `platform` narrows to `NodeJS.Platform` in the
// engine — assert the bootstrap properties are all strings instead. The
// object-typed `clientIdentity` is intentionally not in this list.
type _bootstrapStringProps = AssertStringProps<
  Pick<
    IBootstrapService,
    | 'platform'
    | 'arch'
    | 'cwd'
    | 'osHomeDir'
    | 'homeDir'
    | 'configPath'
    | 'sessionsDir'
    | 'blobsDir'
    | 'storeDir'
    | 'cacheDir'
    | 'logsDir'
  >
>;
type AssertStringProps<T> = T extends Record<string, string> ? true : never;
const _envProps: _bootstrapStringProps = true;

// ── session scope ───────────────────────────────────────────────────────────

// session/metadata.ts
const _sessionMeta: AssertWire<typeof sessionMetaSchema, SessionMeta> = true;
const _agentMeta: AssertWire<typeof agentMetaSchema, AgentMeta> = true;
const _sessionMetaPatch: AssertWire<typeof sessionMetaPatchSchema, SessionMetaPatch> = true;
const _sessionMetadataChangedEvent: AssertWire<
  typeof sessionMetadataChangedEventSchema,
  SessionMetadataChangedEvent
> = true;

// session/lifecycle.ts
const _createSessionOptions: AssertWire<typeof createSessionOptionsSchema, CreateSessionOptions> =
  true;
const _forkSessionOptions: AssertWire<typeof forkSessionOptionsSchema, ForkSessionOptions> = true;
const _resumeSessionOptions: AssertWire<typeof resumeSessionOptionsSchema, ResumeSessionOptions> =
  true;
const _createChildSessionOptions: AssertWire<
  typeof createChildSessionOptionsSchema,
  CreateChildSessionOptions
> = true;
// One-directional: the wire handle is `z.looseObject` — the in-process
// `ISessionScopeHandle` carries an `accessor` and `dispose()` that JSON
// drops, so only the engine → wire direction holds.
const _handleWire: AssertEngineToWire<typeof handleWireSchema, ISessionScopeHandle> = true;

// session/interaction.ts
const _interaction: AssertWire<typeof interactionSchema, Interaction> = true;
const _interactionResolution: AssertWire<
  typeof interactionResolutionSchema,
  InteractionResolution
> = true;

// session/approval.ts
// One-directional: `display` is the protocol `ToolInputDisplay` union (huge)
// and crosses the wire as `unknown`; the wire schema cannot be assignable
// back to the engine type.
const _approvalRequest: AssertEngineToWire<typeof approvalRequestSchema, ApprovalRequest> = true;
const _approvalResponse: AssertWire<typeof approvalResponseSchema, ApprovalResponse> = true;

// session/question.ts
const _questionRequest: AssertWire<typeof questionRequestSchema, QuestionRequest> = true;
const _questionItem: AssertWire<typeof questionItemSchema, QuestionItem> = true;
const _questionOption: AssertWire<typeof questionOptionSchema, QuestionOption> = true;
const _questionAnswers: AssertWire<typeof questionAnswersSchema, QuestionAnswers> = true;
const _questionResponse: AssertWire<typeof questionResponseSchema, QuestionResponse> = true;
const _questionResult: AssertWire<typeof questionResultSchema, QuestionResult> = true;

// session/skills.ts
const _skillSummary: AssertWire<typeof skillSummarySchema, SkillSummary> = true;

// session/title.ts
const _generateTitleOutput: AssertWire<
  (typeof sessionTitleContract)['generateTitle']['output'],
  Awaited<ReturnType<ISessionTitleService['generateTitle']>>
> = true;

// session/activity.ts
const _sessionActivityState: AssertWire<typeof sessionActivityStateSchema, SessionActivityState> =
  true;

// ── agent scope (services.ts / schemas.ts) ──────────────────────────────────
// Payload/result types are derived from the domain service interfaces the
// facade calls, so the assertions track the exact methods the contract
// mirrors; facade-only payload shapes (cancel / setPermission / plan / task /
// command) derive from the `AgentFacade` input types.
type ActivateSkillPayload = Parameters<IAgentSkillService['activate']>[0];
type PromptWithSkillsPayload = Parameters<IAgentSkillService['promptWithSkills']>[0];
type PromptSkillActivation = PromptWithSkillsPayload['skills'][number];
type AgentCommandInfo = ReturnType<IAgentCommandService['list']>[number];
type RuntimeBinding = ReturnType<IAgentRuntimeBindingService['get']>;
type RunShellCommandPayload = Parameters<IAgentShellCommandService['run']>[0];
type ShellCommandResult = Awaited<ReturnType<IAgentShellCommandService['run']>>;
type SetModelResult = Awaited<ReturnType<IAgentProfileService['setModel']>>;
type TokenUsage = NonNullable<UsageStatus['total']>;
type PromptPart = Extract<ContentPart, { type: 'text' | 'image_url' | 'video_url' }>;

type EmptyPayload = {};
type CancelPayload = NonNullable<Parameters<AgentFacade['cancel']>[0]>;
type SetPermissionPayload = { mode: PermissionMode };
type RunCommandPayload = Parameters<AgentFacade['runCommand']>[0];
type CancelShellCommandPayload = Parameters<AgentFacade['cancelShellCommand']>[0];
type SetModelPayload = { model: string };
type CancelPlanPayload = NonNullable<Parameters<AgentFacade['cancelPlan']>[0]>;
type GetTasksPayload = NonNullable<Parameters<AgentFacade['getTasks']>[0]>;
type StopTaskPayload = Parameters<AgentFacade['stopTask']>[0];
type GetTaskOutputPayload = Parameters<AgentFacade['getTaskOutput']>[0];

const _emptyPayload: AssertWire<typeof emptyPayloadSchema, EmptyPayload> = true;
const _promptPart: AssertWire<typeof promptPartSchema, PromptPart> = true;
// One-directional (wire → engine): the engine's `PromptPayload.input` accepts
// the full `ContentPart` union (also think/audio parts); the wire mirrors the
// `PromptPart` subset clients may send, so the reverse direction fails.
const _promptPayload: AssertWireToEngine<typeof promptPayloadSchema, PromptPayload> = true;
const _promptSkillActivation: AssertWire<
  typeof promptSkillActivationSchema,
  PromptSkillActivation
> = true;
// Same one-directional rule as `promptPayload`: the engine's `input` accepts
// the full `ContentPart` union; the wire mirrors the `PromptPart` subset.
const _promptWithSkillsPayload: AssertWireToEngine<
  typeof promptWithSkillsPayloadSchema,
  PromptWithSkillsPayload
> = true;
const _steerPayload: AssertWireToEngine<typeof steerPayloadSchema, SteerPayload> = true;
const _activateSkillPayload: AssertWire<typeof activateSkillPayloadSchema, ActivateSkillPayload> =
  true;
const _promptLaunchResult: AssertWire<typeof promptLaunchResultSchema, PromptLaunchResult> = true;
type PromptWithSkillsResult = Awaited<ReturnType<IAgentSkillService['promptWithSkills']>>;
const _promptWithSkillsResult: AssertWire<
  typeof promptWithSkillsResultSchema,
  PromptWithSkillsResult
> = true;
const _cancelPayload: AssertWire<typeof cancelPayloadSchema, CancelPayload> = true;
const _runShellCommandPayload: AssertWire<
  typeof runShellCommandPayloadSchema,
  RunShellCommandPayload
> = true;
const _shellCommandResult: AssertWire<typeof shellCommandResultSchema, ShellCommandResult> = true;
const _cancelShellCommandPayload: AssertWire<
  typeof cancelShellCommandPayloadSchema,
  CancelShellCommandPayload
> = true;
const _setModelPayload: AssertWire<typeof setModelPayloadSchema, SetModelPayload> = true;
const _setModelResult: AssertWire<typeof setModelResultSchema, SetModelResult> = true;
const _setPermissionPayload: AssertWire<typeof setPermissionPayloadSchema, SetPermissionPayload> =
  true;
const _tokenUsage: AssertWire<typeof tokenUsageSchema, TokenUsage> = true;
const _usageStatus: AssertWire<typeof usageStatusSchema, UsageStatus> = true;
// One-directional: `history` entries are full `ContextMessage`s (deep
// `Message`/`Tool`/`PromptOrigin` unions) mirrored as `unknown`.
const _agentContextData: AssertEngineToWire<typeof agentContextDataSchema, AgentContextData> = true;
const _agentCommandInfo: AssertWire<typeof agentCommandInfoSchema, AgentCommandInfo> = true;
const _runtimeBinding: AssertWire<typeof runtimeBindingSchema, RuntimeBinding> = true;
const _runCommandPayload: AssertWire<typeof runCommandPayloadSchema, RunCommandPayload> = true;
const _planData: AssertWire<typeof planDataSchema, PlanData> = true;
const _cancelPlanPayload: AssertWire<typeof cancelPlanPayloadSchema, CancelPlanPayload> = true;
const _getTasksPayload: AssertWire<typeof getTasksPayloadSchema, GetTasksPayload> = true;
// The wire task union mirrors the protocol `TaskInfo`; the engine's
// declaration-merged `AgentTaskInfo` is structurally identical but depends on
// tool-module augmentation, so parity is pinned to the protocol type.
const _agentTaskInfo: AssertWire<typeof agentTaskInfoSchema, TaskInfo> = true;
const _stopTaskPayload: AssertWire<typeof stopTaskPayloadSchema, StopTaskPayload> = true;
const _getTaskOutputPayload: AssertWire<typeof getTaskOutputPayloadSchema, GetTaskOutputPayload> =
  true;

// agent/services.ts (mcp / fullCompaction)
const _mcpServerEntry: AssertWire<typeof mcpServerEntrySchema, McpServerEntry> = true;
const _fullCompactionInput: AssertWire<typeof fullCompactionInputSchema, FullCompactionInput> =
  true;

// ── agent scope (events.ts) ─────────────────────────────────────────────────
// Parity against the protocol event types (the stream carries flat
// `{ type, ... }` events; schemas keep the `type` literal). One-directional
// where a field is mirrored as `unknown`.
const _turnStartedEvent: AssertEngineToWire<typeof turnStartedEventSchema, TurnStartedEvent> = true;
const _turnEndedEvent: AssertEngineToWire<typeof turnEndedEventSchema, TurnEndedEvent> = true;
const _assistantDeltaEvent: AssertWire<typeof assistantDeltaEventSchema, AssistantDeltaEvent> =
  true;
const _thinkingDeltaEvent: AssertWire<typeof thinkingDeltaEventSchema, ThinkingDeltaEvent> = true;
const _toolCallStartedEvent: AssertEngineToWire<
  typeof toolCallStartedEventSchema,
  ToolCallStartedEvent
> = true;
const _toolCallDeltaEvent: AssertWire<typeof toolCallDeltaEventSchema, ToolCallDeltaEvent> = true;
const _toolProgressEvent: AssertWire<typeof toolProgressEventSchema, ToolProgressEvent> = true;
const _toolResultEvent: AssertWire<typeof toolResultEventSchema, ToolResultEvent> = true;
const _promptCompletedEvent: AssertWire<typeof promptCompletedEventSchema, PromptCompletedEvent> =
  true;
const _promptAbortedEvent: AssertWire<typeof promptAbortedEventSchema, PromptAbortedEvent> = true;
const _compactionStartedEvent: AssertWire<
  typeof compactionStartedEventSchema,
  CompactionStartedEvent
> = true;
const _compactionBlockedEvent: AssertWire<
  typeof compactionBlockedEventSchema,
  CompactionBlockedEvent
> = true;
const _compactionCancelledEvent: AssertWire<
  typeof compactionCancelledEventSchema,
  CompactionCancelledEvent
> = true;
const _compactionCompletedEvent: AssertWire<
  typeof compactionCompletedEventSchema,
  CompactionCompletedEvent
> = true;
const _warningEvent: AssertWire<typeof warningEventSchema, WarningEvent> = true;
// No parity assertions for `errorEventSchema`, `permissionApproval*Schema`,
// and `agentStatusUpdatedEventSchema`: they are deliberately `z.looseObject`s
// (index signature breaks both-ways assignability) — `permission.approval.*`
// is not part of the protocol event union at all.
