import type { AgentProfileSummary, ConnectorEntry, SkillSummary } from '@hilbras/omnicode-api';
import type { Terminal } from '@hilbras/omnicode-tui';
import { describe, expect, it, vi } from 'vitest';

const openUrl = vi.fn();
vi.mock('#/utils/open-url', () => ({ openUrl: (...args: unknown[]) => openUrl(...args) }));

import {
  ConnectorsBrowserController,
  SkillsBrowserController,
  SubagentsBrowserController,
  type CatalogBrowserHost,
  type CatalogBrowserState,
} from '#/tui/controllers/catalog-browser';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (text: string): string => text.replaceAll(ANSI, '');

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeTerminal(rows = 20): Terminal {
  return {
    start: () => {},
    stop: () => {},
    drainInput: () => Promise.resolve(),
    write: () => {},
    get columns() {
      return 120;
    },
    get rows() {
      return rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: () => {},
    clearFromCursor: () => {},
    clearScreen: () => {},
    setTitle: () => {},
    setProgress: () => {},
  };
}

interface HostOptions {
  hasSession?: boolean;
  skills?: SkillSummary[];
  profiles?: AgentProfileSummary[];
  connectors?: ConnectorEntry[];
  skillError?: Error;
  profileError?: Error;
  connectorError?: Error;
  githubStartError?: Error;
  githubPollError?: Error;
  githubDisconnectError?: Error;
  vercelConnectError?: Error;
  vercelDisconnectError?: Error;
}

function makeHost(options: HostOptions = {}) {
  const listWorkspaceSkills = vi.fn(async () => {
    if (options.skillError !== undefined) throw options.skillError;
    return options.skills ?? [];
  });
  const listWorkspaceAgentProfiles = vi.fn(async () => {
    if (options.profileError !== undefined) throw options.profileError;
    return options.profiles ?? [];
  });
  const listWorkspaceConnectors = vi.fn(async () => {
    if (options.connectorError !== undefined) throw options.connectorError;
    return options.connectors ?? [];
  });
  const listSkills = vi.fn(async () => {
    if (options.skillError !== undefined) throw options.skillError;
    return options.skills ?? [];
  });
  const runSlashCommand = vi.fn();
  const startGitHubDeviceFlow = vi.fn(async () => {
    if (options.githubStartError !== undefined) throw options.githubStartError;
    return {
      flowId: 'flow-1',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
      intervalSeconds: 1,
      scopes: ['repo'],
    };
  });
  const pollGitHubDeviceFlow = vi.fn(async () => {
    if (options.githubPollError !== undefined) throw options.githubPollError;
    return { kind: 'pending' as const };
  });
  const connectVercel = vi.fn(async () => {
    if (options.vercelConnectError !== undefined) throw options.vercelConnectError;
    return {
      connected: true,
      status: { configured: true, connected: true, scopes: [], expired: false },
      message: 'The Vercel connector is connected as the acme team.',
    };
  });
  const disconnectVercel = vi.fn(async () => {
    if (options.vercelDisconnectError !== undefined) throw options.vercelDisconnectError;
    return { disconnected: true, message: 'The stored Vercel credential was removed.' };
  });
  const disconnectGitHub = vi.fn(async () => {
    if (options.githubDisconnectError !== undefined) throw options.githubDisconnectError;
    return {
      disconnected: true,
      providerRevoked: false,
      message: 'The local GitHub credential was removed.',
    };
  });

  const ui = {
    children: [] as unknown[],
    focused: undefined as unknown,
    clear() {
      this.children = [];
    },
    addChild(child: unknown) {
      this.children.push(child);
    },
    setFocus(target: unknown) {
      this.focused = target;
    },
    requestRender: vi.fn(),
  };
  const editor = { marker: 'editor' };
  const state = {
    terminal: fakeTerminal(),
    ui,
    editor,
    appState: { workDir: '/tmp/work' },
    skillsBrowser: undefined as CatalogBrowserState | undefined,
    subagentsBrowser: undefined as CatalogBrowserState | undefined,
    connectorsBrowser: undefined as CatalogBrowserState | undefined,
  };
  const host = {
    state,
    harness: {
      listWorkspaceSkills,
      listWorkspaceAgentProfiles,
      listWorkspaceConnectors,
      startGitHubDeviceFlow,
      pollGitHubDeviceFlow,
      disconnectGitHub,
      connectVercel,
      disconnectVercel,
    },
    session: options.hasSession === false ? undefined : { listSkills },
    setSkillsBrowser(value: CatalogBrowserState | undefined) {
      state.skillsBrowser = value;
    },
    setSubagentsBrowser(value: CatalogBrowserState | undefined) {
      state.subagentsBrowser = value;
    },
    setConnectorsBrowser(value: CatalogBrowserState | undefined) {
      state.connectorsBrowser = value;
    },
    runSlashCommand,
  };
  return {
    host: host as unknown as CatalogBrowserHost,
    state,
    ui,
    editor,
    listSkills,
    runSlashCommand,
    harness: {
      listWorkspaceSkills,
      listWorkspaceAgentProfiles,
      listWorkspaceConnectors,
      startGitHubDeviceFlow,
      pollGitHubDeviceFlow,
      disconnectGitHub,
      connectVercel,
      disconnectVercel,
    },
  };
}

function skill(name: string, description: string): SkillSummary {
  return { name, description, path: `/skills/${name}`, source: 'project' };
}

function profile(name: string, description: string, whenToUse?: string): AgentProfileSummary {
  return { name, description, whenToUse };
}

function connector(entry: Partial<ConnectorEntry> & { id: string }): ConnectorEntry {
  return {
    kind: 'mcp',
    name: entry.id,
    scope: 'user',
    status: 'active',
    capabilities: ['tools'],
    actions: ['open-mcp'],
    ...entry,
  };
}

function rendered(state: CatalogBrowserState | undefined): string {
  if (state === undefined) return '';
  return state.component.render(80).map(strip).join('\n');
}

describe('SkillsBrowserController', () => {
  it('lists the session skills once a session exists', async () => {
    const { host, state, listSkills, harness } = makeHost({
      skills: [skill('review', 'Review code')],
    });
    const controller = new SkillsBrowserController(host);

    await controller.show();

    expect(listSkills).toHaveBeenCalledTimes(1);
    expect(harness.listWorkspaceSkills).not.toHaveBeenCalled();
    expect(rendered(state.skillsBrowser)).toContain('review');
    expect(rendered(state.skillsBrowser)).toContain('Review code');
    controller.close();
  });

  it('lists the workspace skills before a session exists', async () => {
    const { host, state, listSkills, harness } = makeHost({
      hasSession: false,
      skills: [skill('review', 'Review code')],
    });
    const controller = new SkillsBrowserController(host);

    await controller.show();

    expect(listSkills).not.toHaveBeenCalled();
    expect(harness.listWorkspaceSkills).toHaveBeenCalledWith('/tmp/work');
    expect(rendered(state.skillsBrowser)).toContain('review');
    controller.close();
  });

  it('opens an empty catalog when the workspace has no skills', async () => {
    const { host, state } = makeHost({ skills: [] });
    const controller = new SkillsBrowserController(host);

    await controller.show();

    expect(state.skillsBrowser).toBeDefined();
    expect(rendered(state.skillsBrowser)).toContain('No skills available.');
    controller.close();
  });

  it('opens the page with the load error when the listing fails', async () => {
    const { host, state } = makeHost({ skillError: new Error('engine offline') });
    const controller = new SkillsBrowserController(host);

    await controller.show();

    expect(state.skillsBrowser).toBeDefined();
    expect(rendered(state.skillsBrowser)).toContain('Failed to load skills: engine offline');
    controller.close();
  });

  it('treats a second invocation while the page is open as a no-op', async () => {
    const { host, state, listSkills } = makeHost({ skills: [skill('review', 'Review code')] });
    const controller = new SkillsBrowserController(host);

    await controller.show();
    const opened = state.skillsBrowser;
    await controller.show();

    expect(listSkills).toHaveBeenCalledTimes(1);
    expect(state.skillsBrowser).toBe(opened);
    controller.close();
  });

  it('ignores a second invocation that races the first load', async () => {
    const { host, state, listSkills } = makeHost({ skills: [skill('review', 'Review code')] });
    const controller = new SkillsBrowserController(host);

    await Promise.all([controller.show(), controller.show()]);

    expect(listSkills).toHaveBeenCalledTimes(1);
    expect(state.skillsBrowser).toBeDefined();
    controller.close();
  });

  it('restores the editor focus and the previous screen on close', async () => {
    const { host, state, ui, editor } = makeHost({ skills: [skill('review', 'Review code')] });
    const rootChild = { marker: 'root' };
    ui.children = [rootChild];
    const controller = new SkillsBrowserController(host);

    await controller.show();
    expect(ui.children).toHaveLength(1);
    expect(ui.focused).toBe(state.skillsBrowser?.component);

    controller.close();

    expect(state.skillsBrowser).toBeUndefined();
    expect(ui.children).toEqual([rootChild]);
    expect(ui.focused).toBe(editor);
  });

  it('does not open a page after the browser was closed while loading', async () => {
    const { host, state } = makeHost({ skills: [skill('review', 'Review code')] });
    const controller = new SkillsBrowserController(host);

    const pending = controller.show();
    controller.close();
    await pending;

    expect(state.skillsBrowser).toBeUndefined();
  });
});

describe('SubagentsBrowserController', () => {
  it('lists the workspace agent profiles', async () => {
    const { host, state, harness } = makeHost({
      profiles: [profile('explore', 'Explore the codebase', 'Use for read-only searches.')],
    });
    const controller = new SubagentsBrowserController(host);

    await controller.show();

    expect(harness.listWorkspaceAgentProfiles).toHaveBeenCalledWith('/tmp/work');
    const out = rendered(state.subagentsBrowser);
    expect(out).toContain('Available Subagents');
    expect(out).toContain('explore');
    expect(out).toContain('Explore the codebase');
    expect(out).toContain('Use for read-only searches.');
    controller.close();
  });

  it('opens an empty catalog when no profiles are configured', async () => {
    const { host, state } = makeHost({ profiles: [] });
    const controller = new SubagentsBrowserController(host);

    await controller.show();

    expect(rendered(state.subagentsBrowser)).toContain('No subagent profiles available.');
    controller.close();
  });

  it('opens the page with the load error when the listing fails', async () => {
    const { host, state } = makeHost({ profileError: new Error('no workspace') });
    const controller = new SubagentsBrowserController(host);

    await controller.show();

    expect(rendered(state.subagentsBrowser)).toContain('Failed to load subagents: no workspace');
    controller.close();
  });

  it('keeps the skills and subagent pages in separate slots', async () => {
    const { host, state } = makeHost({
      skills: [skill('review', 'Review code')],
      profiles: [profile('explore', 'Explore the codebase')],
    });
    const skills = new SkillsBrowserController(host);
    const subagents = new SubagentsBrowserController(host);

    await skills.show();
    await subagents.show();

    expect(state.skillsBrowser).toBeDefined();
    expect(state.subagentsBrowser).toBeDefined();
    expect(state.skillsBrowser?.component).not.toBe(state.subagentsBrowser?.component);

    skills.close();
    expect(state.skillsBrowser).toBeUndefined();
    expect(state.subagentsBrowser).toBeDefined();
    subagents.close();
  });
});

describe('ConnectorsBrowserController', () => {
  it('lists the workspace connectors with their kind, status, scope and actions', async () => {
    const { host, state, harness } = makeHost({
      connectors: [
        connector({ id: 'mcp:github', name: 'github', scope: 'workspace' }),
        connector({
          id: 'plugin:omnicode-datasource',
          name: 'Omnicode Datasource',
          kind: 'plugin',
          scope: 'user',
          capabilities: ['skills', 'tools'],
          actions: ['open-plugins'],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();

    expect(harness.listWorkspaceConnectors).toHaveBeenCalledWith('/tmp/work');
    const out = rendered(state.connectorsBrowser);
    expect(out).toContain('Connectors');
    expect(out).toContain('github');
    expect(out).toContain('mcp · active · workspace scope · tools · open /mcp');
    expect(out).toContain('Omnicode Datasource');
    expect(out).toContain('plugin · active · user scope · skills, tools · open /plugins');
    controller.close();
  });

  it('opens the browser and shows the user code when the GitHub entry is selected', async () => {
    const { host, state, harness } = makeHost({
      connectors: [
        connector({
          id: 'github',
          name: 'GitHub',
          kind: 'service',
          status: 'needs-auth',
          actions: ['connect-github'],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    expect(harness.startGitHubDeviceFlow).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith('https://github.com/login/device', expect.any(Function));
    const out = rendered(state.connectorsBrowser);
    expect(out).toContain('https://github.com/login/device');
    expect(out).toContain('WDJB-MJHT');
    controller.close();
  });

  it('reports a failed device flow without opening a page', async () => {
    const { host, state, harness } = makeHost({
      connectors: [
        connector({
          id: 'github',
          name: 'GitHub',
          kind: 'service',
          actions: ['connect-github'],
        }),
      ],
      githubStartError: new Error('The GitHub connector is not configured.'),
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    expect(rendered(state.connectorsBrowser)).toContain('The GitHub connector is not configured.');
    controller.close();
  });

  it('disconnects GitHub and refreshes the catalog', async () => {
    const { host, state, harness } = makeHost({
      connectors: [
        connector({
          id: 'github',
          name: 'GitHub',
          kind: 'service',
          status: 'active',
          actions: ['disconnect-github'],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    expect(harness.disconnectGitHub).toHaveBeenCalledTimes(1);
    expect(rendered(state.connectorsBrowser)).toContain('The local GitHub credential was removed.');
    controller.close();
  });

  // The catalog re-renders itself after every action. If the re-render took
  // a second screen takeover it would capture the browser as the thing to
  // restore, and closing the page would put the browser back on screen
  // instead of the transcript and the editor.
  it('restores the page underneath after a refresh re-rendered the connectors', async () => {
    const { host, state, ui, editor } = makeHost({
      connectors: [
        connector({
          id: 'github',
          name: 'GitHub',
          kind: 'service',
          status: 'active',
          actions: ['disconnect-github'],
        }),
      ],
    });
    const rootChild = { marker: 'root' };
    ui.children = [rootChild];
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();
    await flush();

    controller.close();

    expect(ui.children).toEqual([rootChild]);
    expect(ui.focused).toBe(editor);
  });

  it('connects Vercel and refreshes the catalog', async () => {
    const { host, state, harness } = makeHost({
      connectors: [
        connector({
          id: 'vercel',
          name: 'Vercel',
          kind: 'service',
          status: 'needs-auth',
          actions: ['connect-vercel'],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    expect(harness.connectVercel).toHaveBeenCalledTimes(1);
    expect(rendered(state.connectorsBrowser)).toContain(
      'The Vercel connector is connected as the acme team.',
    );
    controller.close();
  });

  it('disconnects Vercel and refreshes the catalog', async () => {
    const { host, state, harness } = makeHost({
      connectors: [
        connector({
          id: 'vercel',
          name: 'Vercel',
          kind: 'service',
          status: 'active',
          actions: ['disconnect-vercel'],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    expect(harness.disconnectVercel).toHaveBeenCalledTimes(1);
    expect(rendered(state.connectorsBrowser)).toContain(
      'The stored Vercel credential was removed.',
    );
    controller.close();
  });

  it('explains why a platform cannot be connected instead of doing nothing', async () => {
    const { host, state } = makeHost({
      connectors: [
        connector({
          id: 'github',
          name: 'GitHub',
          kind: 'service',
          status: 'not-configured',
          actions: [],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    const out = rendered(state.connectorsBrowser);
    expect(out).toContain('GitHub is not configured yet');
    expect(out).toContain('github.clientId');
    controller.close();
  });

  it('explains that a disabled platform needs its experimental flag', async () => {
    const { host, state } = makeHost({
      connectors: [
        connector({
          id: 'vercel',
          name: 'Vercel',
          kind: 'service',
          status: 'unavailable',
          actions: [],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');
    await flush();

    expect(rendered(state.connectorsBrowser)).toContain('Enable its experimental flag');
    controller.close();
  });

  it('shows the connector description next to the kind', async () => {
    const { host, state } = makeHost({
      connectors: [connector({ id: 'mcp:github', name: 'github', description: 'stdio' })],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();

    expect(rendered(state.connectorsBrowser)).toContain('mcp · stdio · active · user scope');
    controller.close();
  });

  it('opens an empty catalog when the workspace has no connectors', async () => {
    const { host, state } = makeHost({ connectors: [] });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();

    expect(state.connectorsBrowser).toBeDefined();
    const out = rendered(state.connectorsBrowser);
    expect(out).toContain('No connectors available.');
    expect(out).toContain('/mcp');
    expect(out).toContain('/plugins');
    controller.close();
  });

  it('opens the page with the load error when the listing fails', async () => {
    const { host, state } = makeHost({ connectorError: new Error('engine offline') });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();

    expect(state.connectorsBrowser).toBeDefined();
    expect(rendered(state.connectorsBrowser)).toContain(
      'Failed to load connectors: engine offline',
    );
    controller.close();
  });

  it('hands an MCP connector over to the /mcp manager', async () => {
    const { host, state, runSlashCommand } = makeHost({
      connectors: [connector({ id: 'mcp:github', name: 'github' })],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');

    expect(runSlashCommand).toHaveBeenCalledWith('mcp');
    expect(state.connectorsBrowser).toBeUndefined();
  });

  it('hands a plugin connector over to the /plugins manager', async () => {
    const { host, state, runSlashCommand } = makeHost({
      connectors: [
        connector({
          id: 'plugin:omnicode-datasource',
          name: 'Omnicode Datasource',
          kind: 'plugin',
          actions: ['open-plugins'],
        }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');

    expect(runSlashCommand).toHaveBeenCalledWith('plugins');
    expect(state.connectorsBrowser).toBeUndefined();
  });

  it('does nothing when the selected connector has no action', async () => {
    const { host, state, runSlashCommand } = makeHost({
      connectors: [
        connector({ id: 'service:github', name: 'github', kind: 'service', actions: [] }),
      ],
    });
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    state.connectorsBrowser?.component.handleInput('\r');

    expect(runSlashCommand).not.toHaveBeenCalled();
    expect(state.connectorsBrowser).toBeDefined();
    controller.close();
  });

  it('restores the editor focus and the previous screen on close', async () => {
    const { host, state, ui, editor } = makeHost({
      connectors: [connector({ id: 'mcp:github', name: 'github' })],
    });
    const rootChild = { marker: 'root' };
    ui.children = [rootChild];
    const controller = new ConnectorsBrowserController(host);

    await controller.show();
    expect(ui.focused).toBe(state.connectorsBrowser?.component);

    controller.close();

    expect(state.connectorsBrowser).toBeUndefined();
    expect(ui.children).toEqual([rootChild]);
    expect(ui.focused).toBe(editor);
  });

  it('does not open a page after the browser was closed while loading', async () => {
    const { host, state } = makeHost({
      connectors: [connector({ id: 'mcp:github', name: 'github' })],
    });
    const controller = new ConnectorsBrowserController(host);

    const pending = controller.show();
    controller.close();
    await pending;

    expect(state.connectorsBrowser).toBeUndefined();
  });
});
