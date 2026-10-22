import { describe, expect, it, vi } from 'vitest';

import { ConnectorCatalogService } from '#/app/connectors/connectorCatalogService';
import type { IFlagService } from '#/app/flag/flag';
import type { IGitHubService } from '#/app/github/github';
import type { GitHubConnectionStatus } from '#/app/github/types';
import type { IMcpConfigStore } from '#/app/mcpConfig/configStore';
import type {
  IMcpManagementService,
  McpManagedServer,
  McpServerAuthState,
} from '#/app/mcpManagement/mcpManagement';
import type { IPluginService } from '#/app/plugin/plugin';
import type { PluginSummary } from '#/app/plugin/types';
import type { VercelConnectionStatus } from '#/app/vercel/types';
import type { IVercelService } from '#/app/vercel/vercel';

const USER_CONFIG_PATH = '/home/user/.omnicode/mcp.json';

interface Stubs {
  readonly servers: readonly McpManagedServer[];
  readonly auth: readonly { readonly name: string; readonly authStatus: McpServerAuthState }[];
  readonly plugins: readonly PluginSummary[];
  readonly github?: GitHubConnectionStatus;
  readonly githubFlagEnabled?: boolean;
  readonly vercel?: VercelConnectionStatus;
  readonly vercelFlagEnabled?: boolean;
}

function vercelStatus(entry: Partial<VercelConnectionStatus> = {}): VercelConnectionStatus {
  return {
    configured: true,
    connected: false,
    scopes: [],
    expired: false,
    ...entry,
  };
}

function githubStatus(entry: Partial<GitHubConnectionStatus> = {}): GitHubConnectionStatus {
  return {
    configured: true,
    connected: false,
    scopes: [],
    expired: false,
    repositoryAccess: 'none',
    repositories: [],
    ...entry,
  };
}

function makeService(stubs: Stubs): ConnectorCatalogService {
  const management = {
    listServers: vi.fn(async () => stubs.servers),
    listAuthStatuses: vi.fn(async () => stubs.auth),
  } as unknown as IMcpManagementService;
  const store = { path: USER_CONFIG_PATH } as unknown as IMcpConfigStore;
  const plugins = { listPlugins: vi.fn(async () => stubs.plugins) } as unknown as IPluginService;
  const github = {
    status: vi.fn(async () => stubs.github ?? githubStatus()),
  } as unknown as IGitHubService;
  const flags = {
    enabled: vi.fn(
      (id: string) =>
        (id === 'github-connector' && stubs.githubFlagEnabled === true) ||
        (id === 'vercel-connector' && stubs.vercelFlagEnabled === true),
    ),
  } as unknown as IFlagService;
  const vercel = {
    status: vi.fn(async () => stubs.vercel ?? vercelStatus()),
  } as unknown as IVercelService;
  return new ConnectorCatalogService(management, store, plugins, github, flags, vercel);
}

function mcpServer(entry: Partial<McpManagedServer> & { readonly name: string }): McpManagedServer {
  return {
    config: { transport: 'stdio', command: 'npx' },
    source: 'global',
    origin: USER_CONFIG_PATH,
    mutable: true,
    ...entry,
  };
}

function plugin(entry: Partial<PluginSummary> & { readonly id: string }): PluginSummary {
  return {
    displayName: entry.id,
    enabled: true,
    state: 'ok',
    skillCount: 0,
    mcpServerCount: 0,
    enabledMcpServerCount: 0,
    hookCount: 0,
    commandCount: 0,
    hasErrors: false,
    source: 'local-path',
    ...entry,
  };
}

describe('ConnectorCatalogService', () => {
  it('lists a first-party platform as unavailable while its experimental flag is off', async () => {
    const service = makeService({ servers: [], auth: [], plugins: [] });

    const entries = await service.listConnectors();

    const github = entries.find((entry) => entry.id === 'github');
    expect(github?.kind).toBe('service');
    expect(github?.status).toBe('unavailable');
    expect(github?.actions).toEqual([]);
  });

  it('offers no connect action for a first-party provider in an untrusted workspace', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      githubFlagEnabled: true,
      vercelFlagEnabled: true,
    });

    const entries = await service.listConnectors();

    for (const id of ['github', 'vercel']) {
      const connector = entries.find((entry) => entry.id === id);
      expect(connector?.status).toBe('needs-trust');
      expect(connector?.actions).toEqual([]);
    }
  });

  it('lists Vercel as needing authorization when the flag is on and no account is connected', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      vercelFlagEnabled: true,
      vercel: vercelStatus(),
    });

    const entries = await service.listConnectors({ workspaceTrusted: true });

    expect(entries).toContainEqual({
      id: 'vercel',
      kind: 'service',
      name: 'Vercel',
      description: 'Projects, deployments, logs',
      scope: 'user',
      status: 'needs-auth',
      capabilities: ['tools'],
      actions: ['connect-vercel'],
    });
  });

  it('lists Vercel as active with a disconnect action once an account is connected', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      vercelFlagEnabled: true,
      vercel: vercelStatus({ connected: true, accountSlug: 'acme' }),
    });

    const entries = await service.listConnectors({ workspaceTrusted: true });

    const vercel = entries.find((entry) => entry.id === 'vercel');
    expect(vercel?.status).toBe('active');
    expect(vercel?.actions).toEqual(['disconnect-vercel']);
  });

  it('lists GitHub as needing authorization when the flag is on and no account is connected', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      githubFlagEnabled: true,
      github: githubStatus(),
    });

    const entries = await service.listConnectors({ workspaceTrusted: true });

    expect(entries).toContainEqual({
      id: 'github',
      kind: 'service',
      name: 'GitHub',
      description: 'Repos, issues, PRs, Actions',
      scope: 'user',
      status: 'needs-auth',
      capabilities: ['tools'],
      actions: ['connect-github'],
    });
  });

  it('lists GitHub as active with a disconnect action once an account is connected', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      githubFlagEnabled: true,
      github: githubStatus({ connected: true, accountLogin: 'octocat', scopes: ['repo'] }),
    });

    const entries = await service.listConnectors({ workspaceTrusted: true });

    const github = entries.find((entry) => entry.id === 'github');
    expect(github?.status).toBe('active');
    expect(github?.actions).toEqual(['disconnect-github']);
  });

  it('lists GitHub as expired when the stored authorization expired', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      githubFlagEnabled: true,
      github: githubStatus({ connected: true, expired: true }),
    });

    const entries = await service.listConnectors({ workspaceTrusted: true });

    expect(entries.find((entry) => entry.id === 'github')?.status).toBe('expired');
  });

  it('lists GitHub as not configured when no client id is configured', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [],
      githubFlagEnabled: true,
      github: githubStatus({ configured: false }),
    });

    const entries = await service.listConnectors({ workspaceTrusted: true });

    expect(entries.find((entry) => entry.id === 'github')?.status).toBe('not-configured');
  });

  it('maps an enabled user-level MCP server to an active connector', async () => {
    const service = makeService({
      servers: [mcpServer({ name: 'github' })],
      auth: [{ name: 'github', authStatus: 'not-applicable' }],
      plugins: [],
    });

    const entries = await service.listConnectors();
    expect(entries.find((entry) => entry.id === 'mcp:github')).toEqual({
      id: 'mcp:github',
      kind: 'mcp',
      name: 'github',
      description: 'stdio',
      scope: 'user',
      status: 'active',
      capabilities: ['tools'],
      actions: ['open-mcp'],
    });
  });

  it('marks a disabled MCP server inactive', async () => {
    const service = makeService({
      servers: [
        mcpServer({
          name: 'github',
          config: { transport: 'stdio', command: 'npx', enabled: false },
        }),
      ],
      auth: [{ name: 'github', authStatus: 'not-applicable' }],
      plugins: [],
    });

    const [connector] = await service.listConnectors();
    expect(connector?.status).toBe('inactive');
  });

  it('maps the OAuth states onto the connection status', async () => {
    const service = makeService({
      servers: [mcpServer({ name: 'needs' }), mcpServer({ name: 'expired' })],
      auth: [
        { name: 'needs', authStatus: 'oauth-required' },
        { name: 'expired', authStatus: 'oauth-expired' },
      ],
      plugins: [],
    });

    const connectors = await service.listConnectors();
    expect(connectors.find((entry) => entry.id === 'mcp:needs')?.status).toBe('needs-auth');
    expect(connectors.find((entry) => entry.id === 'mcp:expired')?.status).toBe('expired');
  });

  it('marks a server with an ambiguous runtime name as an error', async () => {
    const service = makeService({
      servers: [mcpServer({ name: 'github' })],
      auth: [{ name: 'github', authStatus: 'unavailable' }],
      plugins: [],
    });

    const [connector] = await service.listConnectors();
    expect(connector?.status).toBe('error');
  });

  it('scopes a project-level server to the workspace', async () => {
    const service = makeService({
      servers: [mcpServer({ name: 'github', origin: '/repo/.mcp.json', mutable: false })],
      auth: [{ name: 'github', authStatus: 'not-applicable' }],
      plugins: [],
    });

    const [connector] = await service.listConnectors();
    expect(connector?.scope).toBe('workspace');
  });

  it('scopes a plugin-provided server to the user', async () => {
    const service = makeService({
      servers: [
        mcpServer({
          name: 'plugin-server',
          source: 'plugin',
          origin: 'omnicode-datasource',
          mutable: false,
          plugin: { id: 'omnicode-datasource', name: 'server' },
        }),
      ],
      auth: [{ name: 'plugin-server', authStatus: 'not-applicable' }],
      plugins: [],
    });

    const [connector] = await service.listConnectors();
    expect(connector?.scope).toBe('user');
  });

  it('maps a plugin to its implemented capabilities', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [
        plugin({
          id: 'superpowers',
          displayName: 'Superpowers',
          version: '1.4.0',
          skillCount: 14,
          commandCount: 2,
          mcpServerCount: 1,
          hookCount: 1,
        }),
      ],
    });

    const entries = await service.listConnectors();
    expect(entries.find((entry) => entry.id === 'plugin:superpowers')).toEqual({
      id: 'plugin:superpowers',
      kind: 'plugin',
      name: 'Superpowers',
      description: 'v1.4.0',
      scope: 'user',
      status: 'active',
      capabilities: ['skills', 'commands', 'tools', 'hooks'],
      actions: ['open-plugins'],
    });
  });

  it('marks a disabled or broken plugin inactive or error', async () => {
    const service = makeService({
      servers: [],
      auth: [],
      plugins: [
        plugin({ id: 'off', displayName: 'Off', enabled: false }),
        plugin({ id: 'broken', displayName: 'Broken', hasErrors: true }),
      ],
    });

    const connectors = await service.listConnectors();
    expect(connectors.find((entry) => entry.id === 'plugin:off')?.status).toBe('inactive');
    expect(connectors.find((entry) => entry.id === 'plugin:broken')?.status).toBe('error');
  });

  it('lists only the first-party platforms when nothing else is configured', async () => {
    const service = makeService({ servers: [], auth: [], plugins: [] });

    const connectors = await service.listConnectors();

    expect(connectors.map((entry) => entry.id)).toEqual(['github', 'vercel']);
    expect(connectors.every((entry) => entry.kind === 'service')).toBe(true);
  });

  it('scopes the MCP listing to the requested directory', async () => {
    const management = {
      listServers: vi.fn(async () => []),
      listAuthStatuses: vi.fn(async () => []),
    } as unknown as IMcpManagementService;
    const service = new ConnectorCatalogService(
      management,
      { path: USER_CONFIG_PATH } as unknown as IMcpConfigStore,
      { listPlugins: vi.fn(async () => []) } as unknown as IPluginService,
      { status: vi.fn(async () => githubStatus()) } as unknown as IGitHubService,
      { enabled: vi.fn(() => false) } as unknown as IFlagService,
      { status: vi.fn(async () => vercelStatus()) } as unknown as IVercelService,
    );

    await service.listConnectors({ cwd: '/repo' });

    expect(management.listServers).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(management.listAuthStatuses).toHaveBeenCalledWith({ cwd: '/repo', verify: false });
  });
});
