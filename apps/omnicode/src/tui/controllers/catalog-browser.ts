import type {
  AgentProfileSummary,
  ConnectorEntry,
  OmnicodeHarness,
  Session,
  SkillSummary,
} from '@hilbras/omnicode-api';
import type { ProcessTerminal, TUI } from '@hilbras/omnicode-tui';

import { openUrl } from '#/utils/open-url';

import {
  CatalogBrowserApp,
  type CatalogBrowserEntry,
  type CatalogBrowserProps,
} from '../components/dialogs/catalog-browser';
import type { CustomEditor } from '../components/editor/custom-editor';
import type { AppState } from '../types';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';

export interface CatalogBrowserHost {
  readonly state: {
    readonly terminal: ProcessTerminal;
    readonly ui: TUI;
    readonly editor: CustomEditor;
    readonly appState: Pick<AppState, 'workDir'>;
    readonly skillsBrowser: CatalogBrowserState | undefined;
    readonly subagentsBrowser: CatalogBrowserState | undefined;
    readonly connectorsBrowser: CatalogBrowserState | undefined;
  };
  readonly harness: OmnicodeHarness;
  readonly session: Session | undefined;
  setSkillsBrowser(value: CatalogBrowserState | undefined): void;
  setSubagentsBrowser(value: CatalogBrowserState | undefined): void;
  setConnectorsBrowser(value: CatalogBrowserState | undefined): void;
  /**
   * Run a built-in slash command as if the user typed it. The connector page
   * uses it to hand over to the existing `/mcp` and `/plugins` managers
   * instead of reimplementing them.
   */
  runSlashCommand(command: string): void;
}

export interface CatalogBrowserState {
  readonly component: CatalogBrowserApp;
  readonly takeover: ScreenTakeover;
  readonly entries: readonly CatalogBrowserEntry[];
  readonly error: string | undefined;
}

/**
 * Read-only skills catalog. Lists the session's skills once a session exists,
 * and the workspace catalog before the (lazily created) first session — the
 * same split `refreshSkillCommands` uses.
 */
export class SkillsBrowserController {
  private loading = false;
  private cancelled = false;

  constructor(private readonly host: CatalogBrowserHost) {}

  async show(): Promise<void> {
    if (this.loading || this.host.state.skillsBrowser !== undefined) return;
    this.loading = true;
    this.cancelled = false;
    try {
      const session = this.host.session;
      const skills =
        session !== undefined
          ? await session.listSkills()
          : await this.host.harness.listWorkspaceSkills(this.host.state.appState.workDir);
      if (this.cancelled) return;
      this.open(skillEntries(skills), undefined);
    } catch (error) {
      if (this.cancelled) return;
      this.open([], `Failed to load skills: ${errorMessage(error)}`);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.cancelled = true;
    closeCatalogBrowser(
      this.host,
      this.host.state.skillsBrowser,
      this.host.setSkillsBrowser.bind(this.host),
    );
  }

  private open(entries: readonly CatalogBrowserEntry[], error: string | undefined): void {
    openCatalogBrowser(
      this.host,
      {
        title: 'Available Skills',
        emptyMessage: 'No skills available.',
        entries,
        error,
        onCancel: () => {
          this.close();
        },
      },
      this.host.setSkillsBrowser.bind(this.host),
    );
  }
}

/**
 * Read-only subagent catalog: the profile definitions configured for the
 * active workspace (project, user, plugin and explicit agent files).
 */
export class SubagentsBrowserController {
  private loading = false;
  private cancelled = false;

  constructor(private readonly host: CatalogBrowserHost) {}

  async show(): Promise<void> {
    if (this.loading || this.host.state.subagentsBrowser !== undefined) return;
    this.loading = true;
    this.cancelled = false;
    try {
      const profiles = await this.host.harness.listWorkspaceAgentProfiles(
        this.host.state.appState.workDir,
      );
      if (this.cancelled) return;
      this.open(profileEntries(profiles), undefined);
    } catch (error) {
      if (this.cancelled) return;
      this.open([], `Failed to load subagents: ${errorMessage(error)}`);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.cancelled = true;
    closeCatalogBrowser(
      this.host,
      this.host.state.subagentsBrowser,
      this.host.setSubagentsBrowser.bind(this.host),
    );
  }

  private open(entries: readonly CatalogBrowserEntry[], error: string | undefined): void {
    openCatalogBrowser(
      this.host,
      {
        title: 'Available Subagents',
        emptyMessage: 'No subagent profiles available.',
        entries,
        error,
        onCancel: () => {
          this.close();
        },
      },
      this.host.setSubagentsBrowser.bind(this.host),
    );
  }
}

/**
 * The integration catalog: the MCP servers, plugins and first-party account
 * connectors the workspace can reach, as reported by the engine's connector
 * catalog. MCP and plugins are delegated to the existing `/mcp` and
 * `/plugins` managers instead of being duplicated here; a first-party
 * connector is connected from this page.
 */
export class ConnectorsBrowserController {
  private loading = false;
  private cancelled = false;
  private component: CatalogBrowserApp | undefined;
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(private readonly host: CatalogBrowserHost) {}

  async show(): Promise<void> {
    if (this.loading || this.host.state.connectorsBrowser !== undefined) return;
    this.loading = true;
    this.cancelled = false;
    try {
      const connectors = await this.host.harness.listWorkspaceConnectors(
        this.host.state.appState.workDir,
      );
      if (this.cancelled) return;
      this.open(connectors, undefined, undefined);
    } catch (error) {
      if (this.cancelled) return;
      this.open([], `Failed to load connectors: ${errorMessage(error)}`, undefined);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.cancelled = true;
    this.stopPolling();
    closeCatalogBrowser(
      this.host,
      this.host.state.connectorsBrowser,
      this.host.setConnectorsBrowser.bind(this.host),
    );
  }

  private open(
    connectors: readonly ConnectorEntry[],
    error: string | undefined,
    status: string | undefined,
  ): void {
    this.component = openCatalogBrowser(
      this.host,
      {
        title: 'Connectors',
        emptyMessage: CONNECTORS_EMPTY_MESSAGE,
        entries: connectors.map(connectorEntry),
        error,
        status,
        onCancel: () => {
          this.close();
        },
        onSelect: (entry) => {
          this.select(entry, connectors);
        },
      },
      this.host.setConnectorsBrowser.bind(this.host),
    );
  }

  private select(entry: CatalogBrowserEntry, connectors: readonly ConnectorEntry[]): void {
    const action = connectors.find((candidate) => candidate.id === entry.id)?.actions[0];
    if (action === 'connect-github') {
      void this.connectGitHub();
      return;
    }
    if (action === 'disconnect-github') {
      void this.disconnectGitHub();
      return;
    }
    if (action === 'connect-vercel') {
      void this.connectVercel();
      return;
    }
    if (action === 'disconnect-vercel') {
      void this.disconnectVercel();
      return;
    }
    const command = managerCommand(entry.id, connectors);
    if (command !== undefined) {
      this.close();
      this.host.runSlashCommand(command);
      return;
    }
    this.setStatus(blockedReason(entry.id, connectors));
  }

  private async connectGitHub(): Promise<void> {
    this.setStatus('Requesting a GitHub device code…');
    let start;
    try {
      start = await this.host.harness.startGitHubDeviceFlow();
    } catch (error) {
      this.setStatus(errorMessage(error));
      return;
    }
    if (this.cancelled) return;
    const verificationUrl = start.verificationUriComplete ?? start.verificationUri;
    openUrl(verificationUrl, (error) => {
      this.setStatus(
        [
          `Open ${verificationUrl} and enter the code ${start.userCode}`,
          `The browser could not be opened: ${error.message}`,
        ].join('\n'),
      );
    });
    this.setStatus(
      [
        `Enter the code ${start.userCode} at ${verificationUrl}`,
        'Waiting for the authorization to finish.',
      ].join('\n'),
    );
    this.schedulePoll(start.flowId, start.intervalSeconds);
  }

  private async disconnectGitHub(): Promise<void> {
    this.setStatus('Removing the stored GitHub credential…');
    try {
      const result = await this.host.harness.disconnectGitHub();
      await this.refresh(result.message);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private async connectVercel(): Promise<void> {
    this.setStatus('Connecting the Vercel account…');
    try {
      const result = await this.host.harness.connectVercel();
      await this.refresh(result.message);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private async disconnectVercel(): Promise<void> {
    this.setStatus('Removing the stored Vercel credential…');
    try {
      const result = await this.host.harness.disconnectVercel();
      await this.refresh(result.message);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private schedulePoll(flowId: string, intervalSeconds: number): void {
    this.stopPolling();
    const delay = Math.max(1, intervalSeconds) * 1000;
    this.pollTimer = setTimeout(() => {
      void this.poll(flowId, delay);
    }, delay);
  }

  private async poll(flowId: string, delay: number): Promise<void> {
    if (this.cancelled) return;
    try {
      const result = await this.host.harness.pollGitHubDeviceFlow(flowId);
      if (result.kind === 'connected') {
        const account = result.status.accountLogin;
        await this.refresh(
          account === undefined ? 'GitHub connected.' : `GitHub connected as ${account}.`,
        );
        return;
      }
      this.schedulePoll(flowId, delay);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private async refresh(status: string): Promise<void> {
    try {
      const connectors = await this.host.harness.listWorkspaceConnectors(
        this.host.state.appState.workDir,
      );
      if (this.cancelled) return;
      this.open(connectors, undefined, status);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private setStatus(status: string): void {
    const component = this.component;
    const browser = this.host.state.connectorsBrowser;
    if (component === undefined || browser === undefined) return;
    component.setProps({
      title: 'Connectors',
      emptyMessage: CONNECTORS_EMPTY_MESSAGE,
      entries: browser.entries,
      error: browser.error,
      status,
      onCancel: () => {
        this.close();
      },
      onSelect: () => {},
    });
    this.host.state.ui.requestRender(true);
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }
}

const CONNECTORS_EMPTY_MESSAGE = [
  'No connectors available.',
  'Add an MCP server with /mcp, install a plugin with /plugins,',
  'or enable a provider connector with its experimental flag.',
].join('\n');

function openCatalogBrowser(
  host: CatalogBrowserHost,
  props: CatalogBrowserProps,
  setBrowser: (value: CatalogBrowserState | undefined) => void,
): CatalogBrowserApp {
  const existing = host.state.connectorsBrowser;
  if (existing !== undefined) {
    // The page is already on screen. Taking a second takeover here would
    // capture the *browser* as the thing to restore, so closing the page would
    // put the browser back instead of the transcript and the editor.
    existing.component.setProps(props);
    setBrowser({ ...existing, entries: props.entries, error: props.error });
    host.state.ui.requestRender(true);
    return existing.component;
  }
  const component = new CatalogBrowserApp(props, host.state.terminal);
  const takeover = beginScreenTakeover(host.state.ui, component);
  setBrowser({
    component,
    takeover,
    entries: props.entries,
    error: props.error,
  });
  host.state.ui.setFocus(component);
  host.state.ui.requestRender(true);
  return component;
}

function closeCatalogBrowser(
  host: CatalogBrowserHost,
  browser: CatalogBrowserState | undefined,
  setBrowser: (value: CatalogBrowserState | undefined) => void,
): void {
  if (browser === undefined) return;
  endScreenTakeover(host.state.ui, browser.takeover);
  setBrowser(undefined);
  host.state.ui.setFocus(host.state.editor);
  host.state.ui.requestRender(true);
}

function skillEntries(skills: readonly SkillSummary[]): CatalogBrowserEntry[] {
  return skills.map((skill) => ({ name: skill.name, detail: skill.description }));
}

function profileEntries(profiles: readonly AgentProfileSummary[]): CatalogBrowserEntry[] {
  return profiles.map((profile) => {
    const parts = [profile.description, profile.whenToUse].filter(
      (part): part is string => part !== undefined && part.length > 0,
    );
    return { name: profile.name, detail: parts.length > 0 ? parts.join(' · ') : undefined };
  });
}

function connectorEntry(connector: ConnectorEntry): CatalogBrowserEntry {
  const capabilities =
    connector.capabilities.length > 0 ? connector.capabilities.join(', ') : 'none';
  const actions =
    connector.actions.length > 0
      ? connector.actions.map((action) => managerLabel(action)).join(', ')
      : 'no actions';
  const parts: string[] = [connector.kind];
  if (connector.description !== undefined && connector.description.length > 0) {
    parts.push(connector.description);
  }
  parts.push(
    connectorStatusLabel(connector.status),
    `${connector.scope} scope`,
    capabilities,
    actions,
  );
  const hint = connectorSetupHint(connector);
  if (hint !== undefined) parts.push(hint);
  return { id: connector.id, name: connector.name, detail: parts.join(' · ') };
}

/** The existing manager a connector action hands over to. */
function managerCommand(
  id: string | undefined,
  connectors: readonly ConnectorEntry[],
): string | undefined {
  const connector = connectors.find((candidate) => candidate.id === id);
  const action = connector?.actions[0];
  if (action === 'open-mcp') return 'mcp';
  if (action === 'open-plugins') return 'plugins';
  return undefined;
}

function managerLabel(action: ConnectorEntry['actions'][number]): string {
  switch (action) {
    case 'open-mcp':
      return 'open /mcp';
    case 'open-plugins':
      return 'open /plugins';
    case 'connect-github':
      return 'connect GitHub';
    case 'disconnect-github':
      return 'disconnect GitHub';
    case 'connect-vercel':
      return 'connect Vercel';
    case 'disconnect-vercel':
      return 'disconnect Vercel';
  }
}

const CONNECTOR_SETUP_HINTS: Readonly<Record<string, string>> = {
  github: 'set github.clientId',
  vercel: 'set vercel.token',
};

function blockedReason(id: string | undefined, connectors: readonly ConnectorEntry[]): string {
  const connector = connectors.find((entry) => entry.id === id);
  if (connector === undefined) return 'That connector is no longer available.';
  if (connector.kind !== 'service') {
    return `Open /mcp or /plugins to manage "${connector.name}".`;
  }
  switch (connector.status) {
    case 'unavailable':
      return `${connector.name} is disabled. Enable its experimental flag to connect it.`;
    case 'not-configured':
      return `${connector.name} is not configured yet. ${
        CONNECTOR_SETUP_HINTS[connector.id] ?? 'Add its settings to config.toml'
      } first.`;
    case 'needs-trust':
      return `Trust this workspace to connect ${connector.name}.`;
    case 'needs-auth':
      return `${connector.name} needs an authorization that has not been completed.`;
    case 'expired':
      return `The ${connector.name} authorization expired. Reconnect it.`;
    case 'error':
      return `${connector.name} reported an error.`;
    default:
      return `${connector.name} has no action available right now.`;
  }
}

function connectorSetupHint(connector: ConnectorEntry): string | undefined {
  if (connector.status !== 'unavailable' && connector.status !== 'not-configured') {
    return undefined;
  }
  const hint = CONNECTOR_SETUP_HINTS[connector.id];
  if (hint === undefined) return undefined;
  return connector.status === 'unavailable' ? `${hint} and enable its experimental flag` : hint;
}

function connectorStatusLabel(status: ConnectorEntry['status']): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'inactive':
      return 'disabled';
    case 'needs-trust':
      return 'needs trust';
    case 'not-configured':
      return 'not configured';
    case 'unavailable':
      return 'disabled';
    case 'needs-auth':
      return 'needs auth';
    case 'expired':
      return 'auth expired';
    case 'error':
      return 'error';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
