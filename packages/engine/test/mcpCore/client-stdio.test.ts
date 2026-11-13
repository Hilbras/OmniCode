import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { Error2 } from '#/errors';
import { mergeStdioEnv, StdioMcpClient, type StdioMcpClientOptions } from '#/mcpCore/client-stdio';
import { McpServerConfigSchema, type McpServerStdioConfig } from '#/mcpCore/config-schema';
import {
  McpResourceSurface,
  McpUnsupportedError,
  capabilityProjection,
} from '#/mcpCore/resourceSurface';
import { HostProcessService } from '#/os/backends/node-local/hostProcessService';
import { FakeRuntime } from '#/runtime/fakeRuntime';

import {
  crashAfterConnectFixture,
  cwdStdioFixture,
  stderrThenExitFixture,
  stdioFixture,
  surfaceStdioFixture,
} from './stubs';

function createClient(
  config: McpServerStdioConfig,
  options: Partial<StdioMcpClientOptions> = {},
): StdioMcpClient {
  const runtime = Object.assign(
    new FakeRuntime(
      { workspaceId: 'workspace', runtimeId: 'local', generation: 'test' },
      { capabilities: ['process'] },
    ),
    { process: new HostProcessService() },
  );
  return new StdioMcpClient(config, {
    runtimeResolver: {
      _serviceBrand: undefined,
      inspect: () => runtime,
      acquire: () => ({
        runtime,
        track: (resource) => resource,
        dispose: () => {},
      }),
    },
    workspaceId: 'workspace',
    runtimeId: 'local',
    defaultCwd: process.cwd(),
    ...options,
  });
}

function isPostCloseTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Not connected') ||
    message.includes('Connection closed') ||
    message.includes('transport is not running')
  );
}

describe('mergeStdioEnv', () => {
  it('does not inherit ambient secrets by default', () => {
    const env = mergeStdioEnv({}, { PATH: '/bin', SECRET_TOKEN: 'leak', HOME: '/home/user' });
    expect(env['PATH']).toBe('/bin');
    expect(env['HOME']).toBe('/home/user');
    expect(env['SECRET_TOKEN']).toBeUndefined();
  });

  it('allows explicit config env without full inheritance', () => {
    const env = mergeStdioEnv({ API_KEY: 'configured' }, { PATH: '/bin', SECRET_TOKEN: 'leak' });
    expect(env['API_KEY']).toBe('configured');
    expect(env['SECRET_TOKEN']).toBeUndefined();
  });

  it('inherits the full env only when explicitly requested', () => {
    const env = mergeStdioEnv({}, { PATH: '/bin', SECRET_TOKEN: 'allowed' }, true);
    expect(env['SECRET_TOKEN']).toBe('allowed');
  });
});

describe('StdioMcpClient', () => {
  it('rejects an unsupported executor when the config is validated', () => {
    const parsed = McpServerConfigSchema.safeParse({
      transport: 'stdio',
      command: 'true',
      executor: 'kaos',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unsupported executor at construction time', () => {
    let thrown: unknown;
    try {
      const client = createClient({
        transport: 'stdio',
        command: 'true',
        executor: 'kaos',
      } as unknown as McpServerStdioConfig);
      void client;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error2);
    expect((thrown as { code?: string }).code).toBe('not_implemented');
  });

  it('uses defaultCwd when config.cwd is omitted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'omnicode-mcp-default-cwd-'));
    const client = createClient(
      {
        transport: 'stdio',
        command: process.execPath,
        args: [cwdStdioFixture],
      },
      { defaultCwd: cwd },
    );
    try {
      await client.connect();
      const result = await client.callTool('get_cwd', {});
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(realpathSync(text)).toBe(realpathSync(cwd));
    } finally {
      await client.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 15000);

  it('prefers explicit config.cwd over defaultCwd', async () => {
    const defaultCwd = mkdtempSync(join(tmpdir(), 'omnicode-mcp-default-cwd-'));
    const configuredCwd = join(defaultCwd, 'configured');
    mkdirSync(configuredCwd);
    const client = createClient(
      {
        transport: 'stdio',
        command: process.execPath,
        args: [cwdStdioFixture],
        cwd: configuredCwd,
      },
      { defaultCwd },
    );
    try {
      await client.connect();
      const result = await client.callTool('get_cwd', {});
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(realpathSync(text)).toBe(realpathSync(configuredCwd));
    } finally {
      await client.close();
      await rm(defaultCwd, { recursive: true, force: true });
      await rm(configuredCwd, { recursive: true, force: true });
    }
  }, 15000);

  it('resolves relative config.cwd from defaultCwd', async () => {
    const defaultCwd = mkdtempSync(join(tmpdir(), 'omnicode-mcp-relative-cwd-'));
    const configuredCwd = join(defaultCwd, 'tools', 'mcp');
    mkdirSync(configuredCwd, { recursive: true });
    const client = createClient(
      {
        transport: 'stdio',
        command: process.execPath,
        args: [cwdStdioFixture],
        cwd: 'tools/mcp',
      },
      { defaultCwd },
    );
    try {
      await client.connect();
      const result = await client.callTool('get_cwd', {});
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(realpathSync(text)).toBe(realpathSync(configuredCwd));
    } finally {
      await client.close();
      await rm(defaultCwd, { recursive: true, force: true });
    }
  }, 15000);

  it('allows explicit config.cwd outside defaultCwd', async () => {
    const defaultCwd = mkdtempSync(join(tmpdir(), 'omnicode-mcp-default-cwd-'));
    const outsideCwd = mkdtempSync(join(tmpdir(), 'omnicode-mcp-outside-cwd-'));
    const client = createClient(
      {
        transport: 'stdio',
        command: process.execPath,
        args: [cwdStdioFixture],
        cwd: outsideCwd,
      },
      { defaultCwd },
    );
    try {
      await client.connect();
      const result = await client.callTool('get_cwd', {});
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(realpathSync(text)).toBe(realpathSync(outsideCwd));
    } finally {
      await client.close();
      await rm(defaultCwd, { recursive: true, force: true });
      await rm(outsideCwd, { recursive: true, force: true });
    }
  }, 15000);

  it('connects, lists tools, and round-trips a text result', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
    });
    try {
      await client.connect();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name).toSorted()).toEqual(['boom', 'echo', 'read_env', 'whoami']);
      const echo = tools.find((t) => t.name === 'echo');
      expect(echo?.description).toBe('Echoes input text');
      expect(echo?.inputSchema).toMatchObject({ type: 'object' });

      const result = await client.callTool('echo', { text: 'hello mcp' });
      expect(result.isError).toBe(false);
      expect(result.content).toEqual([{ type: 'text', text: 'hello mcp' }]);
    } finally {
      await client.close();
    }
  }, 15000);

  it('propagates server-reported isError', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
    });
    try {
      await client.connect();
      const result = await client.callTool('boom', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({ type: 'text', text: 'boom!' });
    } finally {
      await client.close();
    }
  }, 15000);

  it('forwards configured env to the spawned server', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
      env: { OMNICODE_TEST_ENV: 'forwarded-value' },
    });
    try {
      await client.connect();
      const result = await client.callTool('read_env', { name: 'OMNICODE_TEST_ENV' });
      expect(result.content).toEqual([{ type: 'text', text: 'forwarded-value' }]);
    } finally {
      await client.close();
    }
  }, 15000);

  it('inherits parent process env so PATH/HOME survive; config.env overrides on conflict', async () => {
    const parentOnly = `OMNICODE_TEST_PARENT_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const shared = `OMNICODE_TEST_SHARED_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    process.env[parentOnly] = 'from-parent';
    process.env[shared] = 'from-parent';
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
      env: { [shared]: 'from-config' },
    });
    try {
      await client.connect();
      const inherited = await client.callTool('read_env', { name: parentOnly });
      expect(inherited.content).toEqual([{ type: 'text', text: 'from-parent' }]);
      const overridden = await client.callTool('read_env', { name: shared });
      expect(overridden.content).toEqual([{ type: 'text', text: 'from-config' }]);
    } finally {
      delete process.env[parentOnly];
      delete process.env[shared];
      await client.close();
    }
  }, 15000);

  it('captures recent stderr into a snapshot the manager can attach to errors', async () => {
    const banner = `omnicode-test-stderr-${Date.now()}`;
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stderrThenExitFixture],
      env: { OMNICODE_TEST_MCP_STDERR: banner },
    });
    try {
      await expect(client.connect()).rejects.toThrow();
      expect(client.stderrSnapshot()).toContain(banner);
    } finally {
      await client.close();
    }
  }, 15000);

  it('keeps the stderr buffer bounded so noisy servers cannot exhaust memory', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
    });
    try {
      await client.connect();
      expect(StdioMcpClient.stderrBufferCapacity).toBeLessThanOrEqual(16 * 1024);
      expect(StdioMcpClient.stderrBufferCapacity).toBeGreaterThanOrEqual(1024);
    } finally {
      await client.close();
    }
  }, 15000);

  it('notifies an unexpected-close listener when the child exits after connect', async () => {
    const banner = `omnicode-test-crash-${Date.now()}`;
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [crashAfterConnectFixture],
      env: { OMNICODE_TEST_MCP_EXIT_AFTER_MS: '50', OMNICODE_TEST_MCP_STDERR: banner },
    });
    const closes: Array<{ stderr?: string; error?: string }> = [];
    client.onUnexpectedClose((reason) => {
      closes.push({ stderr: reason.stderr, error: reason.error?.message });
    });
    try {
      await client.connect();
      for (let i = 0; i < 100; i++) {
        if (closes.length > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(closes).toHaveLength(1);
      expect(closes[0]?.stderr ?? '').toContain(banner);
    } finally {
      await client.close();
    }
  }, 15000);

  it('buffers an early close and replays it on listener registration', async () => {
    const banner = `omnicode-test-early-${Date.now()}`;
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [crashAfterConnectFixture],
      env: { OMNICODE_TEST_MCP_STDERR: banner, OMNICODE_TEST_MCP_EXIT_CODE: '0' },
    });
    try {
      await client.connect();
      const reply = await client.callTool('exit_after_reply', {});
      expect(reply.isError).toBe(false);
      const exitDeadline = Date.now() + 5000;
      while (Date.now() < exitDeadline && !client.stderrSnapshot().includes(banner)) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(client.stderrSnapshot()).toContain(banner);

      const drainDeadline = Date.now() + 5000;
      let transportConfirmedDead = false;
      while (Date.now() < drainDeadline) {
        try {
          await client.callTool('echo', { text: 'probe' });
        } catch (error) {
          if (isPostCloseTransportError(error)) {
            transportConfirmedDead = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(transportConfirmedDead).toBe(true);

      let received: { stderr?: string } | undefined;
      let syncedOnRegister = false;
      client.onUnexpectedClose((reason) => {
        syncedOnRegister = true;
        received = { stderr: reason.stderr };
      });
      expect(syncedOnRegister).toBe(true);
      expect(received).toBeDefined();
    } finally {
      await client.close();
    }
  }, 15000);

  it('does not fire unexpected-close when the caller closes the client itself', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
    });
    const closes: number[] = [];
    client.onUnexpectedClose(() => closes.push(Date.now()));
    await client.connect();
    await client.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(closes).toEqual([]);
  }, 15000);
});

describe('StdioMcpClient resources/prompts surface', () => {
  it('reports no capabilities before initialize', () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [surfaceStdioFixture],
    });
    expect(client.advertisedCapabilities()).toEqual([]);
  });

  it('advertises server capabilities after initialize', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [surfaceStdioFixture],
    });
    try {
      await client.connect();
      expect(client.advertisedCapabilities()).toContain('resources');
      expect(client.advertisedCapabilities()).toContain('prompts');
    } finally {
      await client.close();
    }
  }, 15000);

  it('lists resources across server pages by passing the cursor through', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [surfaceStdioFixture],
    });
    try {
      await client.connect();
      const page1 = await client.listResources();
      expect(page1.items.map((resource) => resource.uri)).toEqual([
        'fixture://alpha',
        'fixture://beta',
      ]);
      expect(page1.items[0]?.description).toBe('First page resource');
      expect(page1.items[0]?.mimeType).toBe('text/plain');
      expect(page1.nextCursor).toBe('page-2');
      const page2 = await client.listResources(page1.nextCursor);
      expect(page2.items.map((resource) => resource.uri)).toEqual(['fixture://huge']);
      expect(page2.nextCursor).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 15000);

  it('returns text and blob resource contents without decoding blobs', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [surfaceStdioFixture],
    });
    try {
      await client.connect();
      const text = await client.readResource('fixture://alpha');
      expect(text).toEqual([
        { uri: 'fixture://alpha', mimeType: 'text/plain', text: 'body of fixture://alpha' },
      ]);
      const binary = await client.readResource('fixture://binary');
      expect(binary[0]?.blob).toBe(Buffer.from([0, 1, 2, 3]).toString('base64'));
      expect(binary[0]?.text).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 15000);

  it('gets a prompt and reports non-text message content as omitted', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [surfaceStdioFixture],
    });
    try {
      await client.connect();
      const result = await client.getPrompt('greet', { who: 'mcp' });
      expect(result.messages).toEqual([
        { role: 'user', text: 'Hello mcp' },
        { role: 'assistant', text: '[image content omitted]' },
      ]);
    } finally {
      await client.close();
    }
  }, 15000);

  it('caps pages and bodies when the client is wrapped in McpResourceSurface', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [surfaceStdioFixture],
    });
    try {
      await client.connect();
      const surface = new McpResourceSurface(
        capabilityProjection('surface', client.advertisedCapabilities()),
        client,
        { maxPageSize: 1, maxResourceChars: 5 },
      );
      const page = await surface.listResources();
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBe('page-2');
      const contents = await surface.readResource('fixture://huge');
      expect(contents[0]?.text).toBe('xxxxx');
      expect(contents[0]?.truncated).toBe(true);
      const labelled = surface.labelResource(contents[0]!);
      expect(labelled).toContain('trust="untrusted"');
    } finally {
      await client.close();
    }
  }, 15000);

  it('maps a server without resources/prompts capabilities to McpUnsupportedError', async () => {
    const client = createClient({
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
    });
    try {
      await client.connect();
      await expect(client.listResources()).rejects.toBeInstanceOf(McpUnsupportedError);
      await expect(client.readResource('fixture://alpha')).rejects.toBeInstanceOf(
        McpUnsupportedError,
      );
      await expect(client.listPrompts()).rejects.toBeInstanceOf(McpUnsupportedError);
      await expect(client.getPrompt('greet', {})).rejects.toBeInstanceOf(McpUnsupportedError);
    } finally {
      await client.close();
    }
  }, 15000);
});

describe('mergeStdioEnv with a restricted environment', () => {
  it('does not pass the whole parent environment by default', () => {
    const merged = mergeStdioEnv(undefined, { PATH: '/usr/bin', SECRET_TOKEN: 'shh' });
    expect(merged['PATH']).toBe('/usr/bin');
    expect(merged['SECRET_TOKEN']).toBeUndefined();

    const explicit = mergeStdioEnv(undefined, { PATH: '/usr/bin', SECRET_TOKEN: 'shh' }, true);
    expect(explicit['SECRET_TOKEN']).toBe('shh');
  });

  it('keeps only the variables a child needs when inheritance is off', () => {
    const merged = mergeStdioEnv(
      { SERVER_TOKEN: 'from-config' },
      { PATH: '/usr/bin', HOME: '/home/u', SECRET_TOKEN: 'shh', AWS_SECRET_ACCESS_KEY: 'k' },
      false,
    );
    expect(merged['PATH']).toBe('/usr/bin');
    expect(merged['HOME']).toBe('/home/u');
    expect(merged['SERVER_TOKEN']).toBe('from-config');
    expect(merged['SECRET_TOKEN']).toBeUndefined();
    expect(merged['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
  });
});

describe('mergeStdioEnv', () => {
  it('enables NODE_USE_ENV_PROXY for a proxy set only in the server config.env', () => {
    const merged = mergeStdioEnv({ HTTP_PROXY: 'http://corp:3128' }, { PATH: '/usr/bin' });
    expect(merged['HTTP_PROXY']).toBe('http://corp:3128');
    expect(merged['NODE_USE_ENV_PROXY']).toBe('1');
    expect(merged['NO_PROXY']).toBe('localhost,127.0.0.1,::1,[::1]');
    expect(merged['PATH']).toBe('/usr/bin');
  });

  it('does not inject NODE_USE_ENV_PROXY when no proxy is configured', () => {
    const merged = mergeStdioEnv(undefined, { PATH: '/usr/bin' });
    expect(merged['NODE_USE_ENV_PROXY']).toBeUndefined();
    expect(merged['PATH']).toBe('/usr/bin');
  });

  it('lets config.env override the parent env', () => {
    const merged = mergeStdioEnv({ FOO: 'override' }, { FOO: 'parent', PATH: '/x' });
    expect(merged['FOO']).toBe('override');
  });

  it('does not depend on a filesystem cwd fixture for env merging', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnicode-mcp-env-'));
    await rm(dir, { recursive: true, force: true });
    expect(mergeStdioEnv(undefined, { PATH: dir })['PATH']).toBe(dir);
  });
});
