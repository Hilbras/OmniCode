import type { McpManagedServerInfo } from '@hilbras/omnicode-api';
import type { Terminal } from '@hilbras/omnicode-tui';
import { describe, expect, it, vi } from 'vitest';

import {
  McpManagerController,
  type McpManagerHost,
  type McpManagerState,
} from '#/tui/controllers/mcp-manager';

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
    columns: 100,
    rows,
    kittyProtocolActive: false,
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

function server(entry: Partial<McpManagedServerInfo> & { name: string }): McpManagedServerInfo {
  return {
    transport: 'stdio',
    command: 'npx',
    source: 'global',
    origin: '/home/user/.omnicode/mcp.json',
    mutable: true,
    ...entry,
  } as McpManagedServerInfo;
}

function makeHost(options: { servers?: McpManagedServerInfo[] } = {}) {
  const listMcpServers = vi.fn(async () => options.servers ?? []);
  const listMcpServerAuthStatuses = vi.fn(async () => []);
  const addMcpServer = vi.fn(async () => options.servers ?? []);
  const updateMcpServer = vi.fn(
    async (_server: unknown, _options: unknown) => options.servers ?? [],
  );
  const removeMcpServer = vi.fn(async () => []);
  const testMcpServer = vi.fn(async () => ({ success: true, output: 'ok' }));
  const runSlashCommand = vi.fn();

  const ui = {
    children: [] as unknown[],
    focused: undefined as { handleInput?: (data: string) => void } | undefined,
    clear() {
      this.children = [];
    },
    addChild(child: unknown) {
      this.children.push(child);
    },
    setFocus(target: unknown) {
      this.focused = target as { handleInput?: (data: string) => void };
    },
    requestRender: vi.fn(),
  };
  const editor = { marker: 'editor' };
  const state = {
    terminal: fakeTerminal(),
    ui,
    editor,
    appState: { workDir: '/tmp/work' },
    mcpManager: undefined as McpManagerState | undefined,
  };
  const host = {
    state,
    harness: {
      listMcpServers,
      listMcpServerAuthStatuses,
      addMcpServer,
      updateMcpServer,
      removeMcpServer,
      testMcpServer,
    },
    showError: vi.fn(),
    setMcpManager(value: McpManagerState | undefined) {
      state.mcpManager = value;
    },
    runSlashCommand,
  };
  return {
    host: host as unknown as McpManagerHost,
    state,
    ui,
    editor,
    listMcpServers,
    listMcpServerAuthStatuses,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    testMcpServer,
  };
}

function rendered(state: { mcpManager: McpManagerState | undefined }): string {
  return state.mcpManager?.component.render(100).map(strip).join('\n') ?? '';
}

describe('McpManagerController', () => {
  it('lists the configured servers with an add entry', async () => {
    const { host, state, listMcpServers } = makeHost({
      servers: [server({ name: 'linear', command: 'npx', args: ['-y', 'linear-mcp'] })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();

    expect(listMcpServers).toHaveBeenCalledWith({ cwd: '/tmp/work' });
    const out = rendered(state);
    expect(out).toContain('MCP servers');
    expect(out).toContain('Add an MCP server');
    expect(out).toContain('linear');
    expect(out).toContain('stdio');
    controller.close();
  });

  it('shows the transport and status in a right-aligned column', async () => {
    const { host, state } = makeHost({
      servers: [server({ name: 'linear', command: 'npx' })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();

    const lines = state.mcpManager?.component.render(100) ?? [];
    const nameRow = lines.find((line) => line.includes('linear')) ?? '';
    expect(nameRow).toContain('stdio');
    expect(nameRow.indexOf('stdio')).toBeGreaterThan(nameRow.indexOf('linear'));
    controller.close();
  });

  it('marks a server that needs authorization', async () => {
    const { host, state, listMcpServerAuthStatuses } = makeHost({
      servers: [server({ name: 'linear' })],
    });
    listMcpServerAuthStatuses.mockResolvedValue([
      { name: 'linear', authStatus: 'oauth-required' },
    ] as never);
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();

    expect(rendered(state)).toContain('needs auth');
    controller.close();
  });

  it('closes the page and restores the editor', async () => {
    const { host, state, ui, editor } = makeHost({
      servers: [server({ name: 'linear' })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();
    expect(state.mcpManager).toBeDefined();

    controller.close();

    expect(state.mcpManager).toBeUndefined();
    expect(ui.focused).toBe(editor);
  });

  // The page re-renders itself after every action. If the re-render took a
  // second screen takeover it would capture the manager as the thing to
  // restore, and closing the page would put the manager back on screen
  // instead of the transcript and the editor.
  it('restores the page underneath after a refresh re-rendered the manager', async () => {
    const { host, state, ui, editor } = makeHost({
      servers: [server({ name: 'linear' })],
    });
    const controller = new McpManagerController(host, () => undefined);
    ui.children.push(editor);

    await controller.show();
    // Testing a server refreshes the listing in place.
    state.mcpManager?.component.handleInput('\x1B[B');
    state.mcpManager?.component.handleInput('\r');
    await flush();
    state.ui.focused?.handleInput?.('\r');
    await flush();
    await flush();

    controller.close();

    expect(ui.children).toEqual([editor]);
    expect(ui.focused).toBe(editor);
  });

  it('tests a server when the test action is picked', async () => {
    const { host, state, testMcpServer } = makeHost({
      servers: [server({ name: 'linear' })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();
    state.mcpManager?.component.handleInput('\x1B[B');
    state.mcpManager?.component.handleInput('\r');
    await flush();
    state.ui.focused?.handleInput?.('\r');
    await flush();
    await flush();

    expect(testMcpServer).toHaveBeenCalledWith('linear', { cwd: '/tmp/work' });
    controller.close();
  });

  it('removes a server when the remove action is picked', async () => {
    const { host, state, removeMcpServer, testMcpServer } = makeHost({
      servers: [server({ name: 'linear' })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();
    state.mcpManager?.component.handleInput('\x1B[B');
    state.mcpManager?.component.handleInput('\r');
    await flush();
    // The action menu is: test connection, edit server, disable server, remove
    // server — three steps down from the first entry.
    for (let step = 0; step < 3; step++) {
      state.ui.focused?.handleInput?.('\x1B[B');
      await flush();
    }
    state.ui.focused?.handleInput?.('\r');
    await flush();
    await flush();

    expect({
      remove: removeMcpServer.mock.calls,
      test: testMcpServer.mock.calls,
    }).toEqual({ remove: [['linear', { cwd: '/tmp/work' }]], test: [] });
    controller.close();
  });

  it('disables a server when the disable action is picked', async () => {
    const { host, state, updateMcpServer, removeMcpServer } = makeHost({
      servers: [server({ name: 'linear' })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();
    state.mcpManager?.component.handleInput('\x1B[B');
    state.mcpManager?.component.handleInput('\r');
    await flush();
    state.ui.focused?.handleInput?.('\x1B[B');
    await flush();
    state.ui.focused?.handleInput?.('\x1B[B');
    await flush();
    state.ui.focused?.handleInput?.('\r');
    await flush();
    await flush();

    expect(updateMcpServer.mock.calls).toHaveLength(1);
    expect(updateMcpServer.mock.calls[0]?.[0]).toMatchObject({ name: 'linear', enabled: false });
    expect(removeMcpServer.mock.calls).toEqual([]);
    controller.close();
  });

  it('saves a new server from the single-page form', async () => {
    const { host, state, addMcpServer } = makeHost({ servers: [] });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();
    state.mcpManager?.component.handleInput('\r');
    await flush();

    const form = state.ui.focused as { handleInput?: (data: string) => void };
    form.handleInput?.('linear');
    form.handleInput?.('\t');
    form.handleInput?.('\t');
    form.handleInput?.('npx');
    form.handleInput?.('\t');
    form.handleInput?.('-y linear-mcp');
    form.handleInput?.('\r');
    await flush();
    await flush();

    expect(addMcpServer).toHaveBeenCalledWith(
      { name: 'linear', transport: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'] },
      { cwd: '/tmp/work' },
    );
    controller.close();
  });

  it('edits an existing server and keeps its name', async () => {
    const { host, state, updateMcpServer } = makeHost({
      servers: [server({ name: 'linear', command: 'npx' })],
    });
    const controller = new McpManagerController(host, () => undefined);

    await controller.show();
    state.mcpManager?.component.handleInput('\x1B[B');
    state.mcpManager?.component.handleInput('\r');
    await flush();

    const picker = state.ui.focused as { handleInput?: (data: string) => void };
    picker.handleInput?.('\x1B[B');
    await flush();
    picker.handleInput?.('\r');
    await flush();
    await flush();

    const form = state.ui.focused as { handleInput?: (data: string) => void };
    form.handleInput?.('\t');
    form.handleInput?.('\t');
    form.handleInput?.('uvx');
    form.handleInput?.('\r');
    await flush();
    await flush();

    expect(updateMcpServer.mock.calls[0]?.[0]).toEqual({
      name: 'linear',
      transport: 'stdio',
      command: 'uvx',
    });
    controller.close();
  });
});
