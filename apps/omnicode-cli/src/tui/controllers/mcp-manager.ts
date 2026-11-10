/**
 * The MCP server manager: add, edit, test, authorize and remove MCP servers
 * from the terminal instead of hand-editing `mcp.json`.
 */

import type {
  GlobalMcpServerAuthStatus,
  McpManagedServerInfo,
  McpServerConfig,
  McpServerInfo,
  OmnicodeHarness,
  Session,
} from '@hilbras/omnicode-api';
import type { Component, Focusable, ProcessTerminal, TUI } from '@hilbras/omnicode-tui';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import {
  McpManagerApp,
  type McpManagerEntry,
  type McpManagerProps,
  type McpServerStatus,
} from '../components/dialogs/mcp-manager';
import { McpServerFormComponent } from '../components/dialogs/mcp-server-form';
import type { CustomEditor } from '../components/editor/custom-editor';
import type { AppState } from '../types';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';

export interface McpManagerHost {
  readonly state: {
    readonly terminal: ProcessTerminal;
    readonly ui: TUI;
    readonly editor: CustomEditor;
    readonly appState: Pick<AppState, 'workDir'>;
    readonly mcpManager: McpManagerState | undefined;
  };
  readonly harness: OmnicodeHarness;
  showError(message: string): void;
  setMcpManager(value: McpManagerState | undefined): void;
}

export interface McpManagerState {
  readonly component: McpManagerApp;
  readonly takeover: ScreenTakeover;
  readonly servers: readonly McpManagedServerInfo[];
  readonly authStatuses: readonly GlobalMcpServerAuthStatus[];
  readonly runtime: readonly McpServerInfo[];
  readonly status: string | undefined;
}

const ADD_SERVER_ID = 'mcp:add';

export class McpManagerController {
  private loading = false;
  private cancelled = false;
  private component: McpManagerApp | undefined;
  private selectedIndex = 0;
  private dialog: (Component & Focusable) | undefined;
  private dialogTakeover: ScreenTakeover | undefined;

  constructor(
    private readonly host: McpManagerHost,
    private readonly currentSession: () => Session | undefined,
  ) {}

  async show(): Promise<void> {
    if (this.loading || this.host.state.mcpManager !== undefined) return;
    this.loading = true;
    this.cancelled = false;
    try {
      const { servers, authStatuses, runtime } = await this.load();
      if (this.cancelled) return;
      this.open(servers, authStatuses, runtime, undefined);
    } catch (error) {
      if (this.cancelled) return;
      this.host.showError(`Failed to load MCP servers: ${errorMessage(error)}`);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.cancelled = true;
    const manager = this.host.state.mcpManager;
    if (manager === undefined) return;
    endScreenTakeover(this.host.state.ui, manager.takeover);
    this.host.setMcpManager(undefined);
    this.host.state.ui.setFocus(this.host.state.editor);
    this.host.state.ui.requestRender(true);
  }

  private open(
    servers: readonly McpManagedServerInfo[],
    authStatuses: readonly GlobalMcpServerAuthStatus[],
    runtime: readonly McpServerInfo[],
    status: string | undefined,
  ): void {
    const open = this.host.state.mcpManager;
    if (open !== undefined) {
      // The page is already on screen. Taking a second takeover here would
      // capture the *manager* as the thing to restore, so closing the page
      // would put the manager back instead of the transcript and the editor.
      open.component.setProps(this.buildProps(servers, authStatuses, runtime, status));
      this.host.setMcpManager({ ...open, servers, authStatuses, runtime, status });
      this.host.state.ui.requestRender(true);
      return;
    }
    const props = this.buildProps(servers, authStatuses, runtime, status);
    this.component = new McpManagerApp(props, this.host.state.terminal);
    const takeover = beginScreenTakeover(this.host.state.ui, this.component);
    this.host.setMcpManager({
      component: this.component,
      takeover,
      servers,
      authStatuses,
      runtime,
      status,
    });
    this.host.state.ui.setFocus(this.component);
    this.host.state.ui.requestRender(true);
  }

  private buildProps(
    servers: readonly McpManagedServerInfo[],
    authStatuses: readonly GlobalMcpServerAuthStatus[],
    runtime: readonly McpServerInfo[],
    status: string | undefined,
  ): McpManagerProps {
    return {
      title: 'MCP servers',
      entries: this.buildEntries(servers, authStatuses, runtime),
      selectedIndex: this.selectedIndex,
      status,
      onCancel: () => {
        this.close();
      },
      onSelect: (entry: McpManagerEntry) => {
        this.selectedIndex = this.buildEntries(servers, authStatuses, runtime).findIndex(
          (candidate) => candidate.id === entry.id,
        );
        if (entry.add === true) {
          this.startAddFlow();
          return;
        }
        this.openServerActions(entry.id, servers);
      },
    };
  }

  private buildEntries(
    servers: readonly McpManagedServerInfo[],
    authStatuses: readonly GlobalMcpServerAuthStatus[],
    runtime: readonly McpServerInfo[],
  ): McpManagerEntry[] {
    const entries: McpManagerEntry[] = [
      { id: ADD_SERVER_ID, name: 'Add an MCP server', add: true },
    ];
    for (const server of servers) {
      const live = runtime.find((entry) => entry.name === server.name);
      const auth = authStatuses.find((entry) => entry.name === server.name)?.authStatus;
      entries.push({
        id: server.name,
        name: server.name,
        transport: server.transport,
        enabled: server.enabled !== false,
        target: server.transport === 'stdio' ? server.command : server.url,
        status: this.statusOf(live, auth),
        scope: server.source === 'global' ? 'user' : server.source,
        toolCount: live?.toolCount,
        readOnly: !server.mutable,
        error: live?.error,
      });
    }
    return entries;
  }

  private statusOf(
    live: McpServerInfo | undefined,
    auth: GlobalMcpServerAuthStatus['authStatus'] | undefined,
  ): McpServerStatus | undefined {
    if (auth === 'oauth-required') return 'needs-auth';
    if (auth === 'oauth-expired') return 'needs-auth';
    if (live === undefined) return undefined;
    if (live.status === 'removed') return undefined;
    return live.status as McpServerStatus;
  }

  private async load(): Promise<{
    servers: readonly McpManagedServerInfo[];
    authStatuses: readonly GlobalMcpServerAuthStatus[];
    runtime: readonly McpServerInfo[];
  }> {
    const cwd = this.host.state.appState.workDir;
    const [servers, authStatuses] = await Promise.all([
      this.host.harness.listMcpServers({ cwd }),
      this.host.harness.listMcpServerAuthStatuses({ cwd, verify: false }),
    ]);
    const session = this.currentSession();
    const runtime = session === undefined ? [] : await session.listMcpServers();
    return { servers, authStatuses, runtime };
  }

  private async refresh(status: string | undefined): Promise<void> {
    try {
      const { servers, authStatuses, runtime } = await this.load();
      if (this.cancelled) return;
      this.open(servers, authStatuses, runtime, status);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private setStatus(status: string): void {
    const manager = this.host.state.mcpManager;
    if (manager === undefined) return;
    manager.component.setProps(
      this.buildProps(manager.servers, manager.authStatuses, manager.runtime, status),
    );
    this.host.setMcpManager({ ...manager, status });
    this.host.state.ui.requestRender(true);
  }

  private startAddFlow(): void {
    const form = new McpServerFormComponent('add', undefined, (result) => {
      this.endDialog();
      if (result.kind === 'cancel') {
        this.setStatus('Adding an MCP server was cancelled.');
        return;
      }
      void this.saveServer(result.config);
    });
    this.mountDialog(form);
  }

  private startEditFlow(server: McpManagedServerInfo): void {
    const form = new McpServerFormComponent('edit', server, (result) => {
      this.endDialog();
      if (result.kind === 'cancel') {
        this.setStatus('Editing the MCP server was cancelled.');
        return;
      }
      void this.saveServer(result.config, server.name);
    });
    this.mountDialog(form);
  }

  private async saveServer(config: McpServerConfig, previousName?: string): Promise<void> {
    const cwd = this.host.state.appState.workDir;
    try {
      if (previousName !== undefined) {
        if (previousName !== config.name) {
          await this.host.harness.removeMcpServer(previousName, { cwd });
        }
        await this.host.harness.updateMcpServer(config, { cwd });
        await this.refresh(`Updated the MCP server "${config.name}".`);
        return;
      }
      await this.host.harness.addMcpServer(config, { cwd });
      await this.refresh(`Added the MCP server "${config.name}".`);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private openServerActions(
    name: string | undefined,
    servers: readonly McpManagedServerInfo[],
  ): void {
    if (name === undefined) return;
    const server = servers.find((entry) => entry.name === name);
    if (server === undefined) return;
    const options = [
      {
        value: 'test',
        label: 'Test connection',
        description: 'connect once and report the result',
      },
    ];
    if (server.mutable) {
      options.push({
        value: 'edit',
        label: 'Edit server',
        description: 'change its name, command or URL',
      });
      options.push({
        value: server.enabled === false ? 'enable' : 'disable',
        label: server.enabled === false ? 'Enable server' : 'Disable server',
        description:
          server.enabled === false
            ? 'start this server with the next session'
            : 'stop starting this server',
      });
      options.push({
        value: 'remove',
        label: 'Remove server',
        description: 'delete this entry',
      });
    }
    const picker = new ChoicePickerComponent({
      title: `MCP server: ${server.name}`,
      options,
      onSelect: (value) => {
        this.endDialog();
        if (value === 'test') {
          void this.testServer(server);
          return;
        }
        if (value === 'edit') {
          this.startEditFlow(server);
          return;
        }
        if (value === 'enable' || value === 'disable') {
          void this.setServerEnabled(server, value === 'enable');
          return;
        }
        if (value === 'remove') {
          void this.removeServer(server);
        }
      },
      onCancel: () => {
        this.endDialog();
        this.setStatus('');
      },
    });
    this.mountDialog(picker);
  }

  private async testServer(server: McpManagedServerInfo): Promise<void> {
    this.setStatus(`Testing "${server.name}"…`);
    try {
      const result = await this.host.harness.testMcpServer(server.name, {
        cwd: this.host.state.appState.workDir,
      });
      await this.refresh(
        result.success
          ? `"${server.name}" responded: ${result.output || 'ok'}`
          : `"${server.name}" failed: ${result.output || 'no output'}`,
      );
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private async setServerEnabled(server: McpManagedServerInfo, enabled: boolean): Promise<void> {
    this.setStatus(`${enabled ? 'Enabling' : 'Disabling'} "${server.name}"…`);
    try {
      await this.host.harness.updateMcpServer(
        { ...server, name: server.name, enabled },
        { cwd: this.host.state.appState.workDir },
      );
      await this.refresh(`${enabled ? 'Enabled' : 'Disabled'} the MCP server "${server.name}".`);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private async removeServer(server: McpManagedServerInfo): Promise<void> {
    this.setStatus(`Removing "${server.name}"…`);
    try {
      await this.host.harness.removeMcpServer(server.name, {
        cwd: this.host.state.appState.workDir,
      });
      await this.refresh(`Removed the MCP server "${server.name}".`);
    } catch (error) {
      this.setStatus(errorMessage(error));
    }
  }

  private mountDialog(dialog: Component & Focusable): void {
    this.endDialog();
    this.dialog = dialog;
    this.dialogTakeover = beginScreenTakeover(this.host.state.ui, dialog);
    this.host.state.ui.setFocus(dialog);
    this.host.state.ui.requestRender(true);
  }

  private endDialog(): void {
    if (this.dialogTakeover !== undefined) {
      endScreenTakeover(this.host.state.ui, this.dialogTakeover);
      this.dialogTakeover = undefined;
    }
    this.dialog = undefined;
    const manager = this.host.state.mcpManager;
    if (manager !== undefined) {
      this.host.state.ui.setFocus(manager.component);
      this.host.state.ui.requestRender(true);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
