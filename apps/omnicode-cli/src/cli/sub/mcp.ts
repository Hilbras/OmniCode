/**
 * `omnicode mcp` — non-interactive MCP server management.
 *
 * Mirrors the TUI `/mcp` manager (apps/omnicode/src/tui/controllers/mcp-manager.ts)
 * over the same engine calls, so a server configured here is the server the TUI
 * shows and the agent connects to. Nothing here talks to an MCP server
 * directly: the engine's management plane owns the config file, the connection
 * probe, and the credential handling.
 *
 * `status` and `tools` reuse the engine's standalone probe, which connects to
 * one server, reports its tools, and tears the connection down again — so the
 * output is the same one `/mcp` shows for a server.
 */

import {
  createOmnicodeHarness,
  type McpManagedServerInfo,
  type McpServerConfig,
  type OmnicodeHarness,
} from '@hilbras/omnicode-api';
import type { Command } from 'commander';

import { createOmnicodeCodeHostIdentity } from '#/cli/version';

interface WritableLike {
  write(chunk: string): boolean;
}

export interface McpDeps {
  readonly getHarness: () => OmnicodeHarness;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly env: NodeJS.ProcessEnv;
  readonly exit: (code: number) => never;
  readonly close: () => Promise<void>;
}

const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const;
type McpTransport = (typeof MCP_TRANSPORTS)[number];

interface ListOptions {
  readonly json: boolean;
  readonly cwd?: string;
}

interface StatusOptions {
  readonly cwd?: string;
  readonly json: boolean;
}

interface InspectOptions {
  readonly cwd?: string;
  readonly json: boolean;
}

interface AddOptions {
  readonly transport?: string;
  readonly command?: string;
  readonly arg?: string[];
  readonly env?: string[];
  readonly header?: string[];
  readonly url?: string;
  readonly cwd?: string;
  readonly inheritEnv?: boolean;
  readonly allowPrivateNetwork?: boolean;
  /** `--bearer-token-env` — commander's own spelling of the option. */
  readonly bearerTokenEnv?: string;
  /** `--tool-timeout` — commander's own spelling of the option. */
  readonly toolTimeout?: string;
  readonly disabled?: boolean;
}

/**
 * `omnicode mcp list` — every configured server, without touching the network.
 *
 * The listing is the redacted view the engine returns: `env` / `headers`
 * values never reach the CLI, only their key names do, so the output is safe
 * to paste into an issue.
 */
export async function handleMcpList(deps: McpDeps, opts: ListOptions): Promise<void> {
  const harness = deps.getHarness();
  const servers = await harness.listMcpServers({ cwd: opts.cwd });

  if (opts.json) {
    deps.stdout.write(`${JSON.stringify({ servers: servers.map(toJsonEntry) }, null, 2)}\n`);
    return;
  }

  if (servers.length === 0) {
    deps.stdout.write('No MCP servers configured.\n');
    deps.stdout.write('Add one with `omnicode mcp add <name> --command <cmd>`.\n');
    return;
  }

  for (const server of servers) {
    deps.stdout.write(
      `${server.name}  transport=${server.transport}  ${serverState(server)}  source=${server.source}` +
        `${server.mutable ? '' : ' (read-only)'}  ${describeServerTarget(server)}\n`,
    );
  }
}

/**
 * `omnicode mcp status` — a live connection check.
 *
 * With a server name the engine's probe output is printed verbatim (it names
 * the tools the server advertises). Without one, every server is probed and
 * summarized, and the command exits non-zero when any probe failed — a status
 * command that always succeeds is a status command nobody reads.
 */
export async function handleMcpStatus(
  deps: McpDeps,
  name: string | undefined,
  opts: StatusOptions,
): Promise<void> {
  const harness = deps.getHarness();
  const servers = await harness.listMcpServers({ cwd: opts.cwd });

  if (name !== undefined) {
    const result = await harness.testMcpServer(name, { cwd: opts.cwd });
    if (opts.json) {
      deps.stdout.write(`${JSON.stringify({ name, ...result }, null, 2)}\n`);
    } else {
      deps.stdout.write(`${result.output}\n`);
    }
    if (!result.success) deps.exit(1);
    return;
  }

  if (servers.length === 0) {
    deps.stdout.write('No MCP servers configured.\n');
    return;
  }

  const results: { name: string; success: boolean; output: string; state: string }[] = [];
  let failed = 0;
  for (const server of servers) {
    if (server.enabled === false) {
      // A disabled server is not started in any session, so probing it would
      // spawn a command the user turned off and report a state they never see.
      results.push({ name: server.name, success: false, output: 'disabled', state: 'disabled' });
      continue;
    }
    const result = await harness.testMcpServer(server.name, { cwd: opts.cwd });
    results.push({
      name: server.name,
      success: result.success,
      output: result.output,
      state: result.success ? 'ok' : 'failed',
    });
    if (!result.success) failed += 1;
  }

  if (opts.json) {
    deps.stdout.write(`${JSON.stringify({ servers: results }, null, 2)}\n`);
  } else {
    for (const entry of results) {
      const summary =
        entry.state === 'disabled'
          ? 'disabled — not started in any session'
          : entry.success
            ? `${countTools(entry.output)} tool(s)`
            : firstLine(entry.output);
      deps.stdout.write(`${entry.name}  ${entry.state.toUpperCase()}  ${summary}\n`);
    }
  }
  if (failed > 0) deps.exit(1);
}

/**
 * `omnicode mcp tools <name>` — the tools one server advertises.
 *
 * The listing comes from the same probe the status command uses, so the tool
 * names are the ones a real connection returned rather than a cached copy.
 */
export async function handleMcpTools(
  deps: McpDeps,
  name: string,
  opts: { readonly cwd?: string; readonly json: boolean },
): Promise<void> {
  const harness = deps.getHarness();
  const result = await harness.testMcpServer(name, { cwd: opts.cwd });
  if (opts.json) {
    deps.stdout.write(`${JSON.stringify({ name, ...result }, null, 2)}\n`);
  } else {
    deps.stdout.write(`${result.output}\n`);
  }
  if (!result.success) deps.exit(1);
}

/**
 * `omnicode mcp inspect <name>` — the stored configuration and the live
 * authorization state of one server.
 *
 * The config is the redacted view, so `env` / `headers` show up as key lists.
 * The authorization check is a real probe against the endpoint, which is why
 * it can report `oauth-expired` for a grant the server no longer accepts.
 */
export async function handleMcpInspect(
  deps: McpDeps,
  name: string,
  opts: InspectOptions,
): Promise<void> {
  const harness = deps.getHarness();
  const server = await harness.getMcpServer(name, { cwd: opts.cwd });
  const inspections = await harness.inspectAppMcpServers(undefined, { cwd: opts.cwd });
  const inspection = inspections.find((candidate) => candidate.runtimeName === name);

  if (opts.json) {
    deps.stdout.write(
      `${JSON.stringify({ server: toJsonEntry(server), inspection: inspection ?? null }, null, 2)}\n`,
    );
    return;
  }

  deps.stdout.write(`Name:       ${server.name}\n`);
  deps.stdout.write(`Transport:  ${server.transport}\n`);
  deps.stdout.write(`Source:     ${server.source}${server.mutable ? '' : ' (read-only)'}\n`);
  deps.stdout.write(`Origin:     ${server.origin}\n`);
  deps.stdout.write(`State:      ${serverState(server)}\n`);
  const target = describeServerTarget(server);
  if (target.length > 0) deps.stdout.write(`Target:     ${target}\n`);
  const envKeys = secretKeyNames(server, 'env');
  if (envKeys.length > 0) {
    deps.stdout.write(`Env keys:   ${envKeys.join(', ')}\n`);
  }
  const headerKeys = secretKeyNames(server, 'headers');
  if (headerKeys.length > 0) {
    deps.stdout.write(`Header keys: ${headerKeys.join(', ')}\n`);
  }
  if (inspection !== undefined) {
    deps.stdout.write(`Auth:       ${inspection.authStatus}\n`);
    if (inspection.error !== undefined) {
      deps.stdout.write(`Auth error: ${inspection.error}\n`);
    }
  }
}

/**
 * `omnicode mcp add <name>` — registers a server in the user's MCP config.
 *
 * The engine owns the file; this only assembles a validated configuration.
 * A stdio server is spawned by the agent, so the command is added — never run
 * — here: nothing is executed until a session connects to it.
 */
export async function handleMcpAdd(deps: McpDeps, name: string, opts: AddOptions): Promise<void> {
  const serverName = name.trim();
  if (serverName.length === 0) {
    deps.stderr.write('Server name is required.\n');
    deps.exit(1);
  }

  const transport = resolveTransport(deps, opts);
  const config = buildServerConfig(deps, serverName, transport, opts);

  const harness = deps.getHarness();
  await harness.addMcpServer(config, { cwd: opts.cwd });
  deps.stdout.write(`Added MCP server "${serverName}" (${transport}).\n`);
  if (opts.env !== undefined && opts.env.length > 0) {
    deps.stdout.write(
      'Note: env values are stored in plaintext in the MCP config file. ' +
        'Prefer a server that reads its own credentials from the environment.\n',
    );
  }
}

/**
 * `omnicode mcp remove <name>` — deletes a server from the user's MCP config.
 *
 * Plugin-contributed and project-layer servers are not removable from here:
 * they belong to their source, and the engine rejects the removal.
 */
export async function handleMcpRemove(
  deps: McpDeps,
  name: string,
  opts: { readonly cwd?: string },
): Promise<void> {
  const harness = deps.getHarness();
  await harness.removeMcpServer(name.trim(), { cwd: opts.cwd });
  deps.stdout.write(`Removed MCP server "${name.trim()}".\n`);
}

/**
 * `omnicode mcp enable <name>` / `omnicode mcp disable <name>`.
 *
 * The stored configuration is read first and sent back with the new state, so
 * the `env` / `headers` values the CLI never saw survive the round trip.
 */
export async function handleMcpSetEnabled(
  deps: McpDeps,
  name: string,
  enabled: boolean,
  opts: { readonly cwd?: string },
): Promise<void> {
  const serverName = name.trim();
  const harness = deps.getHarness();
  const current = await harness.getMcpServer(serverName, { cwd: opts.cwd });
  const config = toEditableConfig(current, enabled);
  await harness.updateMcpServer(config, { cwd: opts.cwd });
  deps.stdout.write(`${enabled ? 'Enabled' : 'Disabled'} MCP server "${serverName}".\n`);
}

export function registerMcpCommand(parent: Command, deps?: Partial<McpDeps>): void {
  const mcp = parent.command('mcp').description('Manage MCP servers non-interactively.');

  const runAction = async (resolved: McpDeps, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      resolved.stderr.write(`${errorMessage(error)}\n`);
      resolved.exit(1);
    } finally {
      await resolved.close();
    }
  };

  mcp
    .command('list')
    .description('List the configured MCP servers.')
    .option('--json', 'Print the servers as JSON.', false)
    .option('--cwd <dir>', 'Also include the project-layer servers of this directory.')
    .action(async (options: { json: boolean; cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpList(resolved, options));
    });

  mcp
    .command('status [name]')
    .description('Connect to the configured servers and report whether they answer.')
    .option('--json', 'Print the results as JSON.', false)
    .option('--cwd <dir>', 'Also include the project-layer servers of this directory.')
    .action(async (name: string | undefined, options: { json: boolean; cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpStatus(resolved, name, options));
    });

  mcp
    .command('tools <name>')
    .description('List the tools one MCP server advertises.')
    .option('--json', 'Print the result as JSON.', false)
    .option('--cwd <dir>', 'Also include the project-layer servers of this directory.')
    .action(async (name: string, options: { json: boolean; cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpTools(resolved, name, options));
    });

  mcp
    .command('inspect <name>')
    .description('Show one MCP server: its stored configuration and authorization state.')
    .option('--json', 'Print the inspection as JSON.', false)
    .option('--cwd <dir>', 'Also include the project-layer servers of this directory.')
    .action(async (name: string, options: { json: boolean; cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpInspect(resolved, name, options));
    });

  mcp
    .command('add <name>')
    .description('Add an MCP server to the user configuration.')
    .option('--transport <transport>', `Transport: ${MCP_TRANSPORTS.join(', ')}.`)
    .option('--command <command>', 'Command to spawn for a stdio server.')
    .option('--arg <value>', 'Argument for the stdio command. Repeatable.', collect, [])
    .option(
      '--env <KEY=VALUE>',
      'Environment variable for the stdio server. Repeatable.',
      collect,
      [],
    )
    .option('--header <KEY=VALUE>', 'HTTP header for a remote server. Repeatable.', collect, [])
    .option('--url <url>', 'Endpoint of a remote (http / sse) server.')
    .option('--cwd <dir>', 'Working directory of the stdio server.')
    .option('--no-inherit-env', 'Do not pass the OmniCode environment to the stdio server.')
    .option(
      '--allow-private-network',
      'Allow a remote endpoint on a private or link-local address.',
    )
    .option('--bearer-token-env <VAR>', 'Read the bearer token from this environment variable.')
    .option('--tool-timeout <ms>', 'Per-tool-call timeout in milliseconds.')
    .option('--disabled', 'Add the server in the disabled state.', false)
    .action(async (name: string, options: AddOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpAdd(resolved, name, options));
    });

  mcp
    .command('remove <name>')
    .description('Remove an MCP server from the user configuration.')
    .option('--cwd <dir>', 'Also consider the project-layer servers of this directory.')
    .action(async (name: string, options: { cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpRemove(resolved, name, options));
    });

  mcp
    .command('enable <name>')
    .description('Enable a configured MCP server.')
    .option('--cwd <dir>', 'Also consider the project-layer servers of this directory.')
    .action(async (name: string, options: { cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpSetEnabled(resolved, name, true, options));
    });

  mcp
    .command('disable <name>')
    .description('Disable a configured MCP server without removing it.')
    .option('--cwd <dir>', 'Also consider the project-layer servers of this directory.')
    .action(async (name: string, options: { cwd?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleMcpSetEnabled(resolved, name, false, options));
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function resolveDeps(overrides: Partial<McpDeps> = {}): McpDeps {
  let harness: OmnicodeHarness | undefined;
  const identity = createOmnicodeCodeHostIdentity();
  return {
    getHarness:
      overrides.getHarness ??
      (() => {
        harness ??= createOmnicodeHarness({ identity });
        return harness;
      }),
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    env: overrides.env ?? process.env,
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
    close:
      overrides.close ??
      (async () => {
        // The v2 harness boots an engine whose watchers hold the event loop
        // open; close it so a one-shot command can exit.
        await harness?.close();
      }),
  };
}

function resolveTransport(deps: McpDeps, opts: AddOptions): McpTransport {
  const declared = opts.transport?.trim().toLowerCase();
  const hasCommand = opts.command !== undefined && opts.command.trim().length > 0;
  const hasUrl = opts.url !== undefined && opts.url.trim().length > 0;
  if (declared !== undefined && declared.length > 0) {
    if (!(MCP_TRANSPORTS as readonly string[]).includes(declared)) {
      deps.stderr.write(
        `Unknown transport "${opts.transport}" (expected one of: ${MCP_TRANSPORTS.join(', ')}).\n`,
      );
      deps.exit(1);
    }
    const transport = declared as McpTransport;
    // A flag the transport cannot use is a mistake, not something to drop on
    // the floor: the user would otherwise get a server they did not ask for.
    if (transport === 'stdio' && hasUrl) {
      deps.stderr.write('--url cannot be used with --transport stdio.\n');
      deps.exit(1);
    }
    if (transport !== 'stdio' && hasCommand) {
      deps.stderr.write(`--command cannot be used with --transport ${transport}.\n`);
      deps.exit(1);
    }
    return transport;
  }
  if (hasCommand && hasUrl) {
    deps.stderr.write(
      'Pass either --command (a local server) or --url (a remote server), not both.\n',
    );
    deps.exit(1);
  }
  if (hasUrl) return 'http';
  if (hasCommand) return 'stdio';
  deps.stderr.write(
    'Cannot tell which transport to use. Pass --transport, --command (stdio) or --url (http).\n',
  );
  deps.exit(1);
}

function buildServerConfig(
  deps: McpDeps,
  name: string,
  transport: McpTransport,
  opts: AddOptions,
): McpServerConfig {
  const toolTimeoutMs = parseTimeout(deps, opts.toolTimeout);
  const common = {
    name,
    ...(opts.disabled === true ? { enabled: false } : {}),
    ...(toolTimeoutMs === undefined ? {} : { toolTimeoutMs }),
  };

  if (transport === 'stdio') {
    const command = opts.command?.trim();
    if (command === undefined || command.length === 0) {
      deps.stderr.write('--command is required for the "stdio" transport.\n');
      deps.exit(1);
    }
    const env = parseKeyValueList(deps, opts.env, '--env');
    return {
      ...common,
      transport: 'stdio',
      command,
      ...(opts.arg === undefined || opts.arg.length === 0 ? {} : { args: opts.arg }),
      ...(env === undefined ? {} : { env }),
      ...(opts.inheritEnv === false ? { inheritEnv: false } : {}),
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    };
  }

  const url = opts.url?.trim();
  if (url === undefined || url.length === 0) {
    deps.stderr.write(`--url is required for the "${transport}" transport.\n`);
    deps.exit(1);
  }
  const headers = parseKeyValueList(deps, opts.header, '--header');
  return {
    ...common,
    transport,
    url,
    ...(headers === undefined ? {} : { headers }),
    ...(opts.bearerTokenEnv === undefined ? {} : { bearerTokenEnvVar: opts.bearerTokenEnv }),
    ...(opts.allowPrivateNetwork === true ? { allowPrivateNetwork: true } : {}),
  };
}

function parseKeyValueList(
  deps: McpDeps,
  entries: string[] | undefined,
  flag: string,
): Record<string, string> | undefined {
  if (entries === undefined || entries.length === 0) return undefined;
  const parsed: Record<string, string> = {};
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      deps.stderr.write(`${flag} expects KEY=VALUE, got "${entry}".\n`);
      deps.exit(1);
    }
    parsed[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return parsed;
}

function parseTimeout(deps: McpDeps, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    deps.stderr.write('--tool-timeout must be a positive number of milliseconds.\n');
    deps.exit(1);
  }
  return value;
}

/**
 * Rebuilds the stored configuration with a new enabled state.
 *
 * The `env` / `headers` values are dropped on purpose: the engine merges the
 * update over the stored entry, so a field the CLI does not send keeps the
 * value it already had.
 */
function toEditableConfig(server: McpManagedServerInfo, enabled: boolean): McpServerConfig {
  const { config } = splitServerEntry(server);
  return { ...config, enabled } as McpServerConfig;
}

/**
 * The names of a server's secret-bearing fields, never their values.
 *
 * A mutable entry carries the full configuration, a read-only one carries only
 * the key names, and the CLI reports the same thing either way.
 */
function secretKeyNames(server: McpManagedServerInfo, field: 'env' | 'headers'): readonly string[] {
  const split = splitServerEntry(server);
  return field === 'env' ? split.envKeys : split.headerKeys;
}

/**
 * Splits a listed server into its configuration and the names of the fields
 * that carry a secret.
 *
 * The listed shape flattens the configuration onto the entry, so the secret
 * maps have to be read through an index signature: the union type has `env`
 * on one branch and `headers` on the others.
 */
function splitServerEntry(server: McpManagedServerInfo): {
  readonly config: Record<string, unknown>;
  readonly envKeys: readonly string[];
  readonly headerKeys: readonly string[];
} {
  const raw = server as unknown as Record<string, unknown>;
  const {
    source: _source,
    origin: _origin,
    mutable: _mutable,
    plugin: _plugin,
    envKeys: rawEnvKeys,
    headerKeys: rawHeaderKeys,
    env: rawEnv,
    headers: rawHeaders,
    ...config
  } = raw;
  const envKeys = Object.keys((rawEnv ?? {}) as Record<string, unknown>).toSorted();
  const headerKeys = Object.keys((rawHeaders ?? {}) as Record<string, unknown>).toSorted();
  return {
    config,
    envKeys: envKeys.length > 0 ? envKeys : ((rawEnvKeys as readonly string[]) ?? []),
    headerKeys: headerKeys.length > 0 ? headerKeys : ((rawHeaderKeys as readonly string[]) ?? []),
  };
}

function toJsonEntry(server: McpManagedServerInfo): Record<string, unknown> {
  const { config, envKeys, headerKeys } = splitServerEntry(server);
  return {
    ...config,
    source: server.source,
    origin: server.origin,
    mutable: server.mutable,
    ...(server.plugin === undefined ? {} : { plugin: server.plugin }),
    ...(envKeys.length === 0 ? {} : { envKeys }),
    ...(headerKeys.length === 0 ? {} : { headerKeys }),
  };
}

function serverState(server: McpManagedServerInfo): string {
  return server.enabled === false ? 'disabled' : 'enabled';
}

function describeServerTarget(server: McpManagedServerInfo): string {
  if (server.transport === 'stdio') {
    const args = server.args ?? [];
    const suffix = args.length > 0 ? ` ${args.join(' ')}` : '';
    return `${server.command ?? ''}${suffix}`;
  }
  return server.url ?? '';
}

function countTools(output: string): number {
  const match = /Available tools: (\d+)/.exec(output);
  return match === null ? 0 : Number.parseInt(match[1] ?? '0', 10);
}

function firstLine(output: string): string {
  const line = output.split('\n').find((candidate) => candidate.trim().length > 0);
  return (line ?? 'failed').trim();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
