/**
 * External MCP conformance, opt-in.
 *
 * The rest of `test/mcpCore/` drives our client against fixtures we wrote, so a
 * protocol detail we got wrong in the same way twice stays invisible. This suite
 * launches a real third-party server — the reference
 * `@modelcontextprotocol/server-filesystem`, resolved by `npx` — and checks the
 * handshake, the tool list and one real tool call through our client.
 *
 * It needs the npm registry, so it is gated and skipped by default:
 *
 *   OMNICODE_MCP_CONFORMANCE=1 pnpm --filter @hilbras/omnicode-engine exec \
 *     vitest run test/mcpCore/external-filesystem-conformance.e2e.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

import { StdioMcpClient, type StdioMcpClientOptions } from '#/mcpCore/client-stdio';
import type { McpServerStdioConfig } from '#/mcpCore/config-schema';
import { MCP_CONFORMANCE_ENV } from '#/human/test/llm/cassette';
import { HostProcessService } from '#/os/backends/node-local/hostProcessService';
import { FakeRuntime } from '#/runtime/fakeRuntime';

const enabled = process.env[MCP_CONFORMANCE_ENV] === '1';
const suite = enabled ? describe : describe.skip;
const TIMEOUT_MS = 180_000;

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omnicode-mcp-conformance-'));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function externalServerConfig(root: string): McpServerStdioConfig {
  return {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', root],
    allowWorkspaceCommand: true,
  };
}

function createClient(root: string): StdioMcpClient {
  const runtime = Object.assign(
    new FakeRuntime(
      { workspaceId: 'workspace', runtimeId: 'local', generation: 'test' },
      { capabilities: ['process'] },
    ),
    { process: new HostProcessService() },
  );
  const options = {
    runtimeResolver: {
      _serviceBrand: undefined,
      inspect: () => runtime,
      acquire: () => ({
        runtime,
        track: (resource: unknown) => resource,
        dispose: () => {},
      }),
    },
    workspaceId: 'workspace',
    runtimeId: 'local',
    defaultCwd: root,
  } as StdioMcpClientOptions;
  return new StdioMcpClient(externalServerConfig(root), options);
}

suite('external MCP server conformance', () => {
  it('completes the handshake and lists the reference server tools', async () => {
    const root = makeRoot();
    const client = createClient(root);
    try {
      await client.connect();
      const tools = await client.listTools();
      const names = tools.map((tool) => tool.name);

      expect(names).toContain('read_text_file');
      expect(names).toContain('list_allowed_directories');
      expect(names).toContain('write_file');
    } finally {
      await client.close();
    }
  }, TIMEOUT_MS);

  it('round-trips a real tool call and its result through our client', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'conformance.txt'), 'external conformance payload\n');
    const client = createClient(root);
    try {
      await client.connect();
      const result = await client.callTool('read_text_file', { path: join(root, 'conformance.txt') });

      expect(JSON.stringify(result)).toContain('external conformance payload');
    } finally {
      await client.close();
    }
  }, TIMEOUT_MS);
});
