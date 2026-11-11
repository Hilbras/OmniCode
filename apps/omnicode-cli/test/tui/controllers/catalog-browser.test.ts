import type { AgentProfileSummary, ConnectorEntry, SkillSummary } from '@hilbras/omnicode-api';
import type { Terminal } from '@hilbras/omnicode-tui';
import { describe, expect, it, vi } from 'vitest';

const openUrl = vi.fn();
vi.mock('#/utils/open-url', () => ({ openUrl: (...args: unknown[]) => openUrl(...args) }));

import {
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
