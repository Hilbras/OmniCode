import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import type { GitHubConnectionStatus } from '#/app/github/types';
import { IMcpConfigStore } from '#/app/mcpConfig/configStore';
import {
  IMcpManagementService,
  type McpManagedServer,
  type McpServerAuthState,
} from '#/app/mcpManagement/mcpManagement';
import { IPluginService } from '#/app/plugin/plugin';
import type { PluginSummary } from '#/app/plugin/types';
import { LifecycleScope } from '#/app/scopes';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import type { VercelConnectionStatus } from '#/app/vercel/types';
import { IVercelService } from '#/app/vercel/vercel';

import {
  IConnectorCatalogService,
  type ConnectorAction,
  type ConnectorCapability,
  type ConnectorEntry,
  type ConnectorQuery,
  type ConnectorScope,
  type ConnectorStatus,
} from './connectors';

export class ConnectorCatalogService implements IConnectorCatalogService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IMcpManagementService private readonly mcp: IMcpManagementService,
    @IMcpConfigStore private readonly store: IMcpConfigStore,
    @IPluginService private readonly plugins: IPluginService,
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
    @IVercelService private readonly vercel: IVercelService,
  ) {}

  async listConnectors(query: ConnectorQuery = {}): Promise<readonly ConnectorEntry[]> {
    const registryQuery = query.cwd === undefined ? {} : { cwd: query.cwd };
    const [servers, authStatuses, plugins] = await Promise.all([
      this.mcp.listServers(registryQuery),
      this.mcp.listAuthStatuses({ ...registryQuery, verify: false }),
      this.plugins.listPlugins(),
    ]);
    const authByName = new Map(authStatuses.map((status) => [status.name, status.authStatus]));
    const entries = servers.map((server) =>
      mcpConnector(server, authByName.get(server.name), this.store.path),
    );
    for (const plugin of plugins) entries.push(pluginConnector(plugin));
    const connectable = query.workspaceTrusted === true;
    entries.push(
      githubConnector(await this.github.status(), connectable, this.flags.enabled(GITHUB_FLAG_ID)),
    );
    entries.push(
      vercelConnector(await this.vercel.status(), connectable, this.flags.enabled(VERCEL_FLAG_ID)),
    );
    return entries;
  }
}

function mcpConnector(
  server: McpManagedServer,
  authStatus: McpServerAuthState | undefined,
  userConfigPath: string,
): ConnectorEntry {
  const enabled = server.config.enabled !== false;
  const scope: ConnectorScope =
    server.source === 'plugin' || server.origin === userConfigPath ? 'user' : 'workspace';
  const capabilities: readonly ConnectorCapability[] = ['tools'];
  const actions: readonly ConnectorAction[] = ['open-mcp'];
  return {
    id: `mcp:${server.name}`,
    kind: 'mcp',
    name: server.name,
    description: server.config.transport,
    scope,
    status: mcpStatus(enabled, authStatus),
    capabilities,
    actions,
  };
}

function mcpStatus(enabled: boolean, authStatus: McpServerAuthState | undefined): ConnectorStatus {
  if (!enabled) return 'inactive';
  if (authStatus === 'oauth-required') return 'needs-auth';
  if (authStatus === 'oauth-expired') return 'expired';
  if (authStatus === 'unavailable') return 'error';
  return 'active';
}

function githubConnector(
  status: GitHubConnectionStatus,
  connectable: boolean,
  enabled: boolean,
): ConnectorEntry {
  return {
    id: 'github',
    kind: 'service',
    name: 'GitHub',
    description: 'Repos, issues, PRs, Actions',
    scope: 'user',
    status: githubStatus(status, connectable, enabled),
    capabilities: ['tools'],
    actions: githubActions(status, connectable, enabled),
  };
}

function githubActions(
  status: GitHubConnectionStatus,
  connectable: boolean,
  enabled: boolean,
): readonly ConnectorAction[] {
  if (!enabled || !connectable) return [];
  return status.connected ? ['disconnect-github'] : ['connect-github'];
}

function githubStatus(
  status: GitHubConnectionStatus,
  connectable: boolean,
  enabled: boolean,
): ConnectorStatus {
  if (!enabled) return 'unavailable';
  if (!connectable) return 'needs-trust';
  if (!status.configured) return 'not-configured';
  if (status.connected) return status.expired ? 'expired' : 'active';
  return 'needs-auth';
}

function vercelConnector(
  status: VercelConnectionStatus,
  connectable: boolean,
  enabled: boolean,
): ConnectorEntry {
  return {
    id: 'vercel',
    kind: 'service',
    name: 'Vercel',
    description: 'Projects, deployments, logs',
    scope: 'user',
    status: vercelStatus(status, connectable, enabled),
    capabilities: ['tools'],
    actions: vercelActions(status, connectable, enabled),
  };
}

function vercelActions(
  status: VercelConnectionStatus,
  connectable: boolean,
  enabled: boolean,
): readonly ConnectorAction[] {
  if (!enabled || !connectable) return [];
  return status.connected ? ['disconnect-vercel'] : ['connect-vercel'];
}

function vercelStatus(
  status: VercelConnectionStatus,
  connectable: boolean,
  enabled: boolean,
): ConnectorStatus {
  if (!enabled) return 'unavailable';
  if (!connectable) return 'needs-trust';
  if (!status.configured) return 'not-configured';
  if (status.connected) return status.expired ? 'expired' : 'active';
  return 'needs-auth';
}

function pluginConnector(plugin: PluginSummary): ConnectorEntry {
  const capabilities: ConnectorCapability[] = [];
  if (plugin.skillCount > 0) capabilities.push('skills');
  if (plugin.commandCount > 0) capabilities.push('commands');
  if (plugin.mcpServerCount > 0) capabilities.push('tools');
  if (plugin.hookCount > 0) capabilities.push('hooks');
  const actions: readonly ConnectorAction[] = ['open-plugins'];
  return {
    id: `plugin:${plugin.id}`,
    kind: 'plugin',
    name: plugin.displayName,
    description: pluginVersion(plugin.version),
    scope: 'user',
    status: pluginStatus(plugin),
    capabilities,
    actions,
  };
}

function pluginVersion(version: string | undefined): string | undefined {
  if (version === undefined) return undefined;
  const trimmed = version.trim();
  if (trimmed.length === 0) return undefined;
  return `v${trimmed.replace(/^v/, '')}`;
}

function pluginStatus(plugin: PluginSummary): ConnectorStatus {
  if (plugin.state === 'error' || plugin.hasErrors) return 'error';
  if (!plugin.enabled) return 'inactive';
  return 'active';
}

registerScopedService(
  LifecycleScope.App,
  IConnectorCatalogService,
  ConnectorCatalogService,
  ScopeActivation.OnDemand,
  'connectorCatalog',
);
