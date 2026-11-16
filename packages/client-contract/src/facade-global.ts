/**
 * The `global` facade — aggregated, single-object-param methods over the
 * engine's app-scope services. Each method maps to one underlying service
 * call (except `env()`, which fans out and merges); the `Caller` underneath
 * applies contract validation and hands the call to the transport. Facade
 * code never sees service tokens, scope routing, or transport details.
 */

import type {
  AuthStatus,
  IOAuthService,
  OAuthLoginOptions,
} from '@hilbras/omnicode-engine/app/auth/auth';
import type { CapabilityStatus } from '@hilbras/omnicode-engine/app/capability/types';
import type {
  ConfigDiagnostic,
  ConfigInspectValue,
  ConfigTarget,
} from '@hilbras/omnicode-engine/app/config/config';
import type { ConnectorEntry } from '@hilbras/omnicode-engine/app/connectors/connectors';
import type { FileMeta } from '@hilbras/omnicode-engine/app/file/fileService';
import type { ExperimentalFeatureState } from '@hilbras/omnicode-engine/app/flag/flag';
import type {
  GitHubConnectResult,
  GitHubConnectionStatus,
  GitHubDeviceFlowStart,
  GitHubDisconnectResult,
} from '@hilbras/omnicode-engine/app/github/types';
import type {
  FsBrowseResponse,
  FsHomeResponse,
} from '@hilbras/omnicode-engine/app/hostFolderBrowser/hostFolderBrowser';
import type { IProviderDiscoveryService } from '@hilbras/omnicode-engine/app/kosongConfig/discovery';
import type { IModelsDevImportService } from '@hilbras/omnicode-engine/app/kosongConfig/modelsDevImport';
import type {
  GlobalMcpServerConfig,
  McpManagedServer,
  McpServerAuthBeginResult,
  McpServerAuthStatus,
  McpServerInspection,
  McpServerLocator,
  McpServerTestResult,
  McpServerTestTarget,
} from '@hilbras/omnicode-engine/app/mcpManagement/mcpManagement';
import type {
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from '@hilbras/omnicode-engine/app/plugin/types';
import type {
  SessionListQuery,
  SessionSummary,
} from '@hilbras/omnicode-engine/app/sessionIndex/sessionIndex';
import type {
  VercelConnectResult,
  VercelConnectionStatus,
  VercelDisconnectResult,
} from '@hilbras/omnicode-engine/app/vercel/types';
import type { Workspace, WorkspaceUpdate } from '@hilbras/omnicode-engine/app/workspace/workspace';
import type { IModelCatalog } from '@hilbras/omnicode-engine/llm-adapter/model/catalog';
import type { Page } from '@hilbras/omnicode-engine/persistence/interface/queryStore';
import type { SessionMeta } from '@hilbras/omnicode-engine/session/sessionMetadata/sessionMetadata';

import type { McpServerConfig } from './contract/mcp.js';
import type { CallOptions } from '@hilbras/omnicode-rpc/channel';
import type {
  AnonymousProviderInput,
  GenerateEvent,
  GenerateInput,
  GenerateParams,
  ProviderInput,
} from './kosong-types.js';

/** Low-level caller the klient factory builds: routes + validates one service call. */
export type Caller = (
  service: string,
  method: string,
  args: unknown[],
  options?: CallOptions,
) => Promise<unknown>;

/** Scoped variant — the factory's real signature; global methods bind the core scope. */
export type ScopedCaller = (
  scope: { readonly workspaceId?: string; readonly sessionId?: string; readonly agentId?: string },
  service: string,
  method: string,
  args: unknown[],
  options?: CallOptions,
) => Promise<unknown>;

/** Streaming variant of `ScopedCaller` — returns a validated `AsyncIterable`. */
export type ScopedStreamCaller = (
  scope: { readonly workspaceId?: string; readonly sessionId?: string; readonly agentId?: string },
  service: string,
  method: string,
  args: unknown[],
) => AsyncIterable<unknown>;

// ---------------------------------------------------------------------------
// Wire-type aliases for engine-sourced shapes (not direct klient
// dependencies) — derived through the service interfaces.
// ---------------------------------------------------------------------------

export type RefreshProviderModelsResponse = Awaited<
  ReturnType<IOAuthService['refreshOAuthProviderModels']>
>;
export type OAuthFlowStart = Awaited<ReturnType<IOAuthService['startLogin']>>;
export type OAuthFlowSnapshot = NonNullable<Awaited<ReturnType<IOAuthService['getFlow']>>>;
export type OAuthLoginCancelResponse = Awaited<ReturnType<IOAuthService['cancelLogin']>>;
export type OAuthLogoutResponse = Awaited<ReturnType<IOAuthService['logout']>>;

export type ModelCatalogItem = Awaited<ReturnType<IModelCatalog['listModels']>>[number];
export type ProviderCatalogItem = Awaited<ReturnType<IModelCatalog['listProviders']>>[number];
export type SetDefaultModelResponse = Awaited<ReturnType<IModelCatalog['setDefaultModel']>>;
export type RefreshProviderModelsOptions = NonNullable<
  Parameters<IProviderDiscoveryService['refreshProviderModels']>[0]
>;

/** String-literal form of the engine's `ConfigTarget` enum, so consumers never import the enum value. */
export type ConfigTargetLiteral = `${ConfigTarget}`;

export type ImportCustomRegistryOptions = Parameters<
  IModelsDevImportService['importCustomRegistry']
>[0];
export type ImportCustomRegistryResult = Awaited<
  ReturnType<IModelsDevImportService['importCustomRegistry']>
>;

// ---------------------------------------------------------------------------
// Facade interfaces
// ---------------------------------------------------------------------------

export interface GlobalSessionsFacade {
  list(query: SessionListQuery): Promise<Page<SessionSummary>>;
  get(id: string): Promise<SessionSummary | undefined>;
  countActive(workspaceIds: readonly string[]): Promise<number>;
  /**
   * Create a session rooted at `workDir` (the workspace is registered
   * implicitly), optionally titled. Returns the persisted metadata. No agent
   * is created — `session(id).agent('main')` materializes it on first use.
   * `mcpServers` injects ephemeral per-session MCP servers: connected only
   * for this session, never persisted.
   */
  create(input: {
    workDir: string;
    additionalDirs?: readonly string[];
    title?: string;
    mcpServers?: Readonly<Record<string, McpServerConfig>>;
  }): Promise<SessionMeta>;
}

export interface GlobalWorkspacesFacade {
  list(): Promise<readonly Workspace[]>;
  get(id: string): Promise<Workspace | undefined>;
  createOrTouch(input: { root: string; name?: string }): Promise<Workspace>;
  update(input: { id: string; patch: WorkspaceUpdate }): Promise<Workspace | undefined>;
  delete(id: string): Promise<void>;
}

export interface GlobalConfigFacade {
  get<T = unknown>(domain: string): Promise<T>;
  getAll(): Promise<Record<string, unknown>>;
  inspect<T = unknown>(domain: string): Promise<ConfigInspectValue<T>>;
  set(input: { domain: string; patch: unknown; target?: ConfigTargetLiteral }): Promise<void>;
  replace(input: { domain: string; value: unknown; target?: ConfigTargetLiteral }): Promise<void>;
  /**
   * Replace several domains in ONE atomic write (the engine's
   * `IConfigService.replaceSections`): a domain mapped to `undefined` is
   * cleared, domains absent from `sections` are left untouched.
   */
  replaceSections(input: {
    sections: Record<string, unknown>;
    target?: ConfigTargetLiteral;
  }): Promise<void>;
  reload(): Promise<void>;
  diagnostics(): Promise<readonly ConfigDiagnostic[]>;
}

export interface GlobalKosongFacade {
  // -- Provider ---------------------------------------------------------
  listProviders(): Promise<readonly ProviderCatalogItem[]>;
  getProvider(id: string): Promise<ProviderCatalogItem>;
  /** Add a named provider (string id + config) or an anonymous single-model provider (object). */
  addProvider(id: string, config: ProviderInput): Promise<void>;
  addProvider(config: AnonymousProviderInput): Promise<void>;
  removeProvider(id: string): Promise<void>;
  refreshProviders(opts?: RefreshProviderModelsOptions): Promise<RefreshProviderModelsResponse>;
  importCustomRegistry(options: ImportCustomRegistryOptions): Promise<ImportCustomRegistryResult>;

  // -- Model ------------------------------------------------------------
  listModels(): Promise<readonly ModelCatalogItem[]>;
  setDefaultModel(id: string): Promise<SetDefaultModelResponse>;

  // -- Generate (streaming) -----------------------------------------------
  generate(
    modelId: string,
    input: GenerateInput,
    params?: GenerateParams,
  ): AsyncIterable<GenerateEvent>;
}

export interface GlobalAuthFacade {
  status(provider?: string): Promise<AuthStatus>;
  summarize(): Promise<readonly AuthStatus[]>;
  /**
   * The engine's own auth-readiness probe for a model (the default model when
   * omitted): resolves config-file apiKey / provider env-bag credentials or an
   * OAuth token, throwing a typed auth error when nothing resolves. Actual
   * model usage does not depend on the OAuth-only {@link summarize} view.
   */
  ensureReady(modelOverride?: string): Promise<void>;
  startLogin(provider?: string, options?: OAuthLoginOptions): Promise<OAuthFlowStart>;
  flow(provider?: string): Promise<OAuthFlowSnapshot | undefined>;
  cancelLogin(provider?: string): Promise<OAuthLoginCancelResponse>;
  logout(provider?: string): Promise<OAuthLogoutResponse>;
  /**
   * @deprecated Use `kosong.refreshProviders({ scope: 'oauth' })` — the
   * kosong facade owns provider-model refresh; this alias remains for one
   * release cycle.
   */
  refreshProviderModels(): Promise<RefreshProviderModelsResponse>;
}

export interface GlobalFlagsFacade {
  list(): Promise<readonly ExperimentalFeatureState[]>;
  enabled(id: string): Promise<boolean>;
  enabledIds(): Promise<readonly string[]>;
  explain(id: string): Promise<ExperimentalFeatureState | undefined>;
  snapshot(): Promise<Record<string, boolean>>;
}

export interface GlobalCapabilitiesFacade {
  list(): Promise<readonly CapabilityStatus[]>;
  get(id: string): Promise<CapabilityStatus>;
  install(id: string): Promise<CapabilityStatus>;
}

export interface GlobalPluginsFacade {
  list(): Promise<readonly PluginSummary[]>;
  info(id: string): Promise<PluginInfo>;
  install(source: string): Promise<PluginSummary>;
  setEnabled(input: { id: string; enabled: boolean }): Promise<void>;
  setMcpServerEnabled(input: { id: string; server: string; enabled: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  reload(): Promise<ReloadSummary>;
  checkUpdates(): Promise<readonly PluginUpdateStatus[]>;
  listCommands(): Promise<readonly PluginCommandDef[]>;
}

export interface GlobalHostFsFacade {
  browse(absPath?: string): Promise<FsBrowseResponse>;
  home(): Promise<FsHomeResponse>;
}

/**
 * The unified MCP management plane (engine `IMcpManagementService`, App
 * scope): CRUD on the user-level `mcp.json`, a connection test probe, the
 * locator-addressed inspection catalog, the auth-status surface, and the
 * locator-addressed OAuth flow operations.
 */
export interface GlobalMcpFacade {
  list(input?: { cwd?: string }): Promise<readonly McpManagedServer[]>;
  get(input: { name: string; cwd?: string }): Promise<McpManagedServer>;
  /** Add a user-level entry; a same-named read-only entry rejects. Returns the refreshed list. */
  add(input: { server: GlobalMcpServerConfig; cwd?: string }): Promise<readonly McpManagedServer[]>;
  /** Replace a user-level entry; read-only entries reject. Returns the refreshed list. */
  update(input: {
    server: GlobalMcpServerConfig;
    cwd?: string;
  }): Promise<readonly McpManagedServer[]>;
  /** Remove a user-level entry; read-only entries reject. Returns the refreshed list. */
  remove(input: { name: string; cwd?: string }): Promise<readonly McpManagedServer[]>;
  /** Probe a real connection: a registry `name`, or an inline `server` config as-is. */
  test(input: McpServerTestTarget): Promise<McpServerTestResult>;
  /** The locator-addressed catalog plus a batched real-connection probe of OAuth candidates. */
  inspect(input?: {
    targets?: readonly McpServerLocator[];
    cwd?: string;
  }): Promise<readonly McpServerInspection[]>;
  /** Per-server OAuth state; omitted `verify` detects implicit OAuth, `false` stays offline. */
  authStatuses(input?: { cwd?: string; verify?: boolean }): Promise<readonly McpServerAuthStatus[]>;
  /** Resolve a legacy name-only auth target to its unambiguous locator. */
  resolveByName(input: { name: string; cwd?: string }): Promise<McpServerLocator>;
  beginAuth(input: { locator: McpServerLocator; cwd?: string }): Promise<McpServerAuthBeginResult>;
  completeAuth(input: { flowId: string; timeoutMs?: number }): Promise<void>;
  cancelAuth(input: { flowId: string }): Promise<void>;
  resetAuth(input: { locator: McpServerLocator; cwd?: string }): Promise<void>;
}

/** The read-only integration catalog: MCP servers and plugins, composed by the engine. */
export interface GlobalConnectorsFacade {
  /**
   * Integrations visible to `cwd`; omitted `cwd` lists the account-wide view.
   * `workspaceTrusted` decides whether a first-party provider may be
   * connected from this workspace.
   */
  list(input?: { cwd?: string; workspaceTrusted?: boolean }): Promise<readonly ConnectorEntry[]>;
}

/**
 * The first-party GitHub account connector: authorization through the OAuth
 * device flow, and the resulting connection state.
 */
export interface GlobalGitHubFacade {
  /** The current connection state; never carries token material. */
  status(): Promise<GitHubConnectionStatus>;
  /** Starts a device flow and returns the user code plus the flow handle. */
  startDeviceFlow(): Promise<GitHubDeviceFlowStart>;
  /** Connects with a manually supplied GitHub access token. */
  connectWithToken(token: string): Promise<GitHubConnectResult>;
  /** Polls a started device flow by its handle. */
  pollDeviceFlow(flowId: string): Promise<GitHubConnectResult>;
  /** Removes the local credential. */
  disconnect(): Promise<GitHubDisconnectResult>;
}

/**
 * The first-party Vercel account connector: the connection state, the
 * connect action, and disconnect. The token never crosses this boundary.
 */
export interface GlobalVercelFacade {
  /** The current connection state; never carries token material. */
  status(): Promise<VercelConnectionStatus>;
  /** Connects using the given token, or the configured one when omitted. */
  connect(token?: string): Promise<VercelConnectResult>;
  /** Removes the stored credential. */
  disconnect(): Promise<VercelDisconnectResult>;
}

/** One downloaded upload: its metadata plus the buffered bytes. */
export interface FileDownload {
  readonly meta: FileMeta;
  readonly data: Uint8Array;
}

export interface GlobalFilesFacade {
  /**
   * Upload buffered bytes to the daemon's file store. Bytes cross the wire
   * base64-encoded (JSON cannot carry them), so very large uploads pay one
   * encode here and one decode in the dispatcher.
   */
  save(input: {
    data: Uint8Array;
    filename: string;
    name?: string;
    mimeType?: string;
    expiresInSec?: number;
  }): Promise<FileMeta>;
  /** Download one upload back into memory. */
  get(fileId: string): Promise<FileDownload>;
  delete(fileId: string): Promise<void>;
}

/** Aggregated host/environment snapshot (`bootstrapService` properties). */
export interface KlientEnvInfo {
  readonly platform: string;
  readonly arch: string;
  readonly cwd: string;
  readonly osHomeDir: string;
  readonly homeDir: string;
  readonly configPath: string;
  readonly clientVersion: string;
  readonly sessionsDir: string;
  readonly blobsDir: string;
  readonly storeDir: string;
  readonly cacheDir: string;
  readonly logsDir: string;
}

export interface GlobalFacade {
  readonly sessions: GlobalSessionsFacade;
  readonly workspaces: GlobalWorkspacesFacade;
  readonly config: GlobalConfigFacade;
  readonly kosong: GlobalKosongFacade;
  readonly auth: GlobalAuthFacade;
  readonly flags: GlobalFlagsFacade;
  readonly plugins: GlobalPluginsFacade;
  readonly capabilities: GlobalCapabilitiesFacade;
  readonly hostFs: GlobalHostFsFacade;
  readonly files: GlobalFilesFacade;
  readonly mcp: GlobalMcpFacade;
  readonly connectors: GlobalConnectorsFacade;
  readonly github: GlobalGitHubFacade;
  readonly vercel: GlobalVercelFacade;
  env(): Promise<KlientEnvInfo>;
}
