/**
 * `omnicode mcp` CLI unit tests. The handlers receive an injected `getHarness`
 * plus capturing stdout/stderr, so no engine is booted and no MCP server is
 * contacted.
 */

import type { McpManagedServerInfo, OmnicodeHarness } from '@hilbras/omnicode-api';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createProgram } from '#/cli/commands';
import { registerMcpCommand, type McpDeps } from '#/cli/sub/mcp';

class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

interface FakeServer {
  readonly name: string;
  readonly transport: 'stdio' | 'http' | 'sse';
  readonly command?: string;
  readonly args?: string[];
  readonly url?: string;
  readonly enabled?: boolean;
  readonly source?: 'global' | 'plugin' | 'caller';
  readonly mutable?: boolean;
  readonly envKeys?: string[];
  readonly headerKeys?: string[];
  readonly bearerTokenEnvVar?: string;
}

interface FakeHarness {
  readonly servers: FakeServer[];
  readonly added: unknown[];
  readonly updated: unknown[];
  readonly removed: string[];
  readonly probes: string[];
  readonly probeResult: { success: boolean; output: string };
}

function makeHarness(overrides: Partial<FakeHarness> = {}): FakeHarness {
  return {
    servers: [],
    added: [],
    updated: [],
    removed: [],
    probes: [],
    probeResult: {
      success: true,
      output: 'Connected to MCP server "docs".\nAvailable tools: 1\n- echo: Echoes text',
    },
    ...overrides,
  };
}

function toManaged(server: FakeServer): McpManagedServerInfo {
  return {
    name: server.name,
    transport: server.transport,
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(server.args === undefined ? {} : { args: server.args }),
    ...(server.url === undefined ? {} : { url: server.url }),
    ...(server.enabled === undefined ? {} : { enabled: server.enabled }),
    ...(server.bearerTokenEnvVar === undefined
      ? {}
      : { bearerTokenEnvVar: server.bearerTokenEnvVar }),
    source: server.source ?? 'global',
    origin: 'user',
    mutable: server.mutable ?? true,
    ...(server.envKeys === undefined ? {} : { envKeys: server.envKeys }),
    ...(server.headerKeys === undefined ? {} : { headerKeys: server.headerKeys }),
  } as unknown as McpManagedServerInfo;
}

function makeDeps(harness: FakeHarness): {
  deps: McpDeps;
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const api = {
    listMcpServers: async () => harness.servers.map(toManaged),
    getMcpServer: async (name: string) => {
      const found = harness.servers.find((server) => server.name === name);
      if (found === undefined) throw new Error(`MCP server "${name}" was not found`);
      return toManaged(found);
    },
    addMcpServer: async (server: unknown) => {
      harness.added.push(server);
      return harness.servers.map(toManaged);
    },
    updateMcpServer: async (server: unknown) => {
      harness.updated.push(server);
      return harness.servers.map(toManaged);
    },
    removeMcpServer: async (name: string) => {
      harness.removed.push(name);
      return harness.servers.map(toManaged);
    },
    testMcpServer: async (name: string) => {
      harness.probes.push(name);
      return harness.probeResult;
    },
    inspectAppMcpServers: async () => [],
  };
  const deps: McpDeps = {
    getHarness: () => api as unknown as OmnicodeHarness,
    stdout: {
      write: (chunk: string) => {
        stdout.push(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr.push(chunk);
        return true;
      },
    },
    env: {},
    exit: ((code: number) => {
      exitCodes.push(code);
      throw new ExitCalled(code);
    }) as McpDeps['exit'],
    close: async () => {},
  };
  return { deps, stdout, stderr, exitCodes };
}

async function runCli(
  deps: McpDeps,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCodes: number[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const program = new Command();
  program.exitOverride();
  registerMcpCommand(program, {
    ...deps,
    stdout: {
      write: (chunk: string) => {
        stdout.push(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr.push(chunk);
        return true;
      },
    },
    exit: ((code: number) => {
      exitCodes.push(code);
      throw new ExitCalled(code);
    }) as McpDeps['exit'],
  });
  try {
    await program.parseAsync(['node', 'omnicode', ...args]);
  } catch (error) {
    if (!(error instanceof ExitCalled)) throw error;
  }
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCodes };
}

// A handler that reports its own failure calls `deps.exit(1)`. Under the real
// `process.exit` that ends the process there; the test double throws instead,
// so `runAction`'s boundary catches the throw and exits a second time. Only the
// final code is what the shell would see, and both are 1.
function failedExit(exitCodes: readonly number[]): boolean {
  return exitCodes.length > 0 && exitCodes.every((code) => code === 1);
}

describe('omnicode mcp', () => {
  it('is registered on the CLI program with its management sub-commands', () => {
    const program = createProgram(
      '0.0.0-test',
      () => {},
      () => {},
    );
    const mcp = program.commands.find((command) => command.name() === 'mcp');
    expect(mcp).toBeDefined();
    expect(mcp!.commands.map((command) => command.name()).toSorted()).toEqual([
      'add',
      'disable',
      'enable',
      'inspect',
      'list',
      'remove',
      'status',
      'tools',
    ]);
  });

  it('lists the configured servers without contacting them', async () => {
    const harness = makeHarness({
      servers: [
        { name: 'docs', transport: 'stdio', command: 'node', args: ['server.js'] },
        { name: 'github', transport: 'http', url: 'https://mcp.example.test/mcp', enabled: false },
      ],
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'list']);

    expect(result.stdout).toContain('docs  transport=stdio  enabled  source=global');
    expect(result.stdout).toContain('github  transport=http  disabled  source=global');
    expect(result.stdout).toContain('https://mcp.example.test/mcp');
    expect(harness.probes).toEqual([]);
  });

  it('reports an empty configuration instead of a blank listing', async () => {
    const { deps } = makeDeps(makeHarness());
    const result = await runCli(deps, ['mcp', 'list']);
    expect(result.stdout).toContain('No MCP servers configured.');
  });

  it('probes every server for status and fails when one does not answer', async () => {
    const harness = makeHarness({
      servers: [{ name: 'docs', transport: 'stdio', command: 'node' }],
      probeResult: { success: false, output: 'MCP server "docs" finished with status failed' },
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'status']);

    expect(result.stdout).toContain('docs  FAILED');
    expect(failedExit(result.exitCodes)).toBe(true);
  });

  it('reports a disabled server as disabled instead of probing it', async () => {
    const harness = makeHarness({
      servers: [
        { name: 'off', transport: 'stdio', command: 'node', enabled: false },
        { name: 'on', transport: 'stdio', command: 'node' },
      ],
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'status']);

    expect(result.stdout).toContain('off  DISABLED  disabled — not started in any session');
    expect(result.stdout).toContain('on  OK');
    // The disabled server is never contacted: probing it would spawn a command
    // the user turned off.
    expect(harness.probes).toEqual(['on']);
  });

  it('prints the tool list of one server', async () => {
    const harness = makeHarness({
      servers: [{ name: 'docs', transport: 'stdio', command: 'node' }],
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'tools', 'docs']);

    expect(result.stdout).toContain('- echo: Echoes text');
    expect(harness.probes).toEqual(['docs']);
  });

  it('adds a stdio server with its arguments and environment', async () => {
    const harness = makeHarness();
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, [
      'mcp',
      'add',
      'docs',
      '--command',
      'node',
      '--arg',
      'server.js',
      '--env',
      'TOKEN=abc',
      '--no-inherit-env',
    ]);

    expect(result.exitCodes).toEqual([]);
    expect(harness.added).toHaveLength(1);
    expect(harness.added[0]).toMatchObject({
      name: 'docs',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'abc' },
      inheritEnv: false,
    });
    expect(result.stdout).toContain('Added MCP server "docs" (stdio).');
    expect(result.stdout).toContain('stored in plaintext');
  });

  it('writes the tool timeout and the bearer-token env var it was given', async () => {
    const harness = makeHarness();
    const { deps } = makeDeps(harness);
    await runCli(deps, [
      'mcp',
      'add',
      'github',
      '--transport',
      'http',
      '--url',
      'https://mcp.example.test/mcp',
      '--bearer-token-env',
      'GITHUB_TOKEN',
      '--tool-timeout',
      '5000',
    ]);

    expect(harness.added[0]).toMatchObject({
      name: 'github',
      transport: 'http',
      url: 'https://mcp.example.test/mcp',
      bearerTokenEnvVar: 'GITHUB_TOKEN',
      toolTimeoutMs: 5000,
    });
  });

  it('refuses a flag the transport cannot use instead of dropping it', async () => {
    const harness = makeHarness();
    const { deps } = makeDeps(harness);

    const both = await runCli(deps, [
      'mcp',
      'add',
      'x',
      '--command',
      'node',
      '--url',
      'https://mcp.example.test/mcp',
    ]);
    expect(both.stderr).toContain('not both');
    expect(failedExit(both.exitCodes)).toBe(true);

    const wrongUrl = await runCli(deps, [
      'mcp',
      'add',
      'x',
      '--transport',
      'stdio',
      '--url',
      'https://mcp.example.test/mcp',
    ]);
    expect(wrongUrl.stderr).toContain('--url cannot be used with --transport stdio');
    expect(failedExit(wrongUrl.exitCodes)).toBe(true);

    const wrongCommand = await runCli(deps, [
      'mcp',
      'add',
      'x',
      '--transport',
      'http',
      '--url',
      'https://mcp.example.test/mcp',
      '--command',
      'node',
    ]);
    expect(wrongCommand.stderr).toContain('--command cannot be used with --transport http');
    expect(failedExit(wrongCommand.exitCodes)).toBe(true);

    expect(harness.added).toEqual([]);
  });

  it('adds a remote server and refuses an unknown transport', async () => {
    const harness = makeHarness();
    const { deps } = makeDeps(harness);
    await runCli(deps, [
      'mcp',
      'add',
      'github',
      '--transport',
      'http',
      '--url',
      'https://mcp.example.test/mcp',
      '--header',
      'Authorization=Bearer x',
    ]);
    expect(harness.added[0]).toMatchObject({
      name: 'github',
      transport: 'http',
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer x' },
    });

    const bad = await runCli(deps, ['mcp', 'add', 'x', '--transport', 'carrier-pigeon']);
    expect(bad.stderr).toContain('Unknown transport "carrier-pigeon"');
    expect(failedExit(bad.exitCodes)).toBe(true);
  });

  it('disables a server while keeping the fields the CLI never sees', async () => {
    const harness = makeHarness({
      servers: [
        {
          name: 'docs',
          transport: 'stdio',
          command: 'node',
          envKeys: ['TOKEN'],
        },
      ],
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'disable', 'docs']);

    expect(result.stdout).toContain('Disabled MCP server "docs".');
    expect(harness.updated[0]).toMatchObject({
      name: 'docs',
      transport: 'stdio',
      command: 'node',
      enabled: false,
    });
    // The redacted key list is not a config field and must not be written back.
    expect(harness.updated[0]).not.toHaveProperty('envKeys');
    expect(harness.updated[0]).not.toHaveProperty('env');
  });

  it('removes a server by name', async () => {
    const harness = makeHarness({
      servers: [{ name: 'docs', transport: 'stdio', command: 'node' }],
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'remove', 'docs']);
    expect(harness.removed).toEqual(['docs']);
    expect(result.stdout).toContain('Removed MCP server "docs".');
  });

  it('shows the stored configuration of one server', async () => {
    const harness = makeHarness({
      servers: [
        {
          name: 'docs',
          transport: 'stdio',
          command: 'node',
          envKeys: ['TOKEN', 'REGISTRY'],
        },
      ],
    });
    const { deps } = makeDeps(harness);
    const result = await runCli(deps, ['mcp', 'inspect', 'docs']);

    expect(result.stdout).toContain('Name:       docs');
    expect(result.stdout).toContain('Env keys:   TOKEN, REGISTRY');
    expect(result.stdout).not.toContain('abc');
  });

  it('never prints the env values a mutable entry carries', async () => {
    const harness = makeHarness({
      servers: [{ name: 'docs', transport: 'stdio', command: 'node' }],
    });
    const api = {
      listMcpServers: async () => [],
      inspectAppMcpServers: async () => [],
      getMcpServer: async () =>
        ({
          name: 'docs',
          transport: 'stdio',
          command: 'node',
          env: { TOKEN: 'super-secret-value' },
          source: 'global',
          origin: 'user',
          mutable: true,
        }) as unknown as McpManagedServerInfo,
    };
    const deps = makeDeps(harness).deps;
    const result = await runCli({ ...deps, getHarness: () => api as unknown as OmnicodeHarness }, [
      'mcp',
      'inspect',
      'docs',
    ]);

    expect(result.stdout).toContain('Env keys:   TOKEN');
    expect(result.stdout).not.toContain('super-secret-value');
  });
});
