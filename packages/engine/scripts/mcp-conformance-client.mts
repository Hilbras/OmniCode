/**
 * OmniCode MCP client adapter for the official conformance suite
 * (`@modelcontextprotocol/conformance`).
 *
 * The suite spawns a conformance server for a scenario and invokes this
 * command as `<command> <serverUrl>` with `MCP_CONFORMANCE_SCENARIO` (and
 * optionally `MCP_CONFORMANCE_CONTEXT`) in the environment. The server
 * records every protocol interaction and decides the checks; this adapter's
 * single job is to drive the real engine client stack honestly — connect
 * with `HttpMcpClient`/`SseMcpClient`, do what the scenario describes, and
 * exit non-zero when the client genuinely could not do it.
 *
 * Loopback servers are expected here: `allowPrivateNetwork: true` is the
 * sanctioned harness setting, never a production default.
 */

import { HttpMcpClient } from '#/mcpCore/client-http';
import { SseMcpClient } from '#/mcpCore/client-sse';
import type { McpServerHttpConfig, McpServerSseConfig } from '#/mcpCore/config-schema';

const STARTUP_TIMEOUT_MS = 20_000;
const TOOL_TIMEOUT_MS = 20_000;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function httpConfig(serverUrl: string): McpServerHttpConfig {
  return { transport: 'http', url: serverUrl, allowPrivateNetwork: true };
}

function sseConfig(serverUrl: string): McpServerSseConfig {
  return { transport: 'sse', url: serverUrl, allowPrivateNetwork: true };
}

async function withHttpClient<T>(
  serverUrl: string,
  body: (client: HttpMcpClient) => Promise<T>,
): Promise<T> {
  const client = new HttpMcpClient(httpConfig(serverUrl), {
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    toolCallTimeoutMs: TOOL_TIMEOUT_MS,
  });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const serverUrl = process.argv[process.argv.length - 1];
  if (serverUrl === undefined || !/^https?:\/\//.test(serverUrl)) {
    fail(`expected the conformance server URL as the last argument, got "${String(serverUrl)}"`);
  }
  const scenario = process.env['MCP_CONFORMANCE_SCENARIO'];
  if (scenario === undefined) {
    fail('MCP_CONFORMANCE_SCENARIO is required');
  }

  switch (scenario) {
    case 'initialize': {
      await withHttpClient(serverUrl, async () => {
        process.stderr.write('initialize: connected\n');
      });
      return;
    }

    case 'tools_call': {
      await withHttpClient(serverUrl, async (client) => {
        const tools = await client.listTools();
        const tool = tools.find((candidate) => candidate.name === 'add_numbers');
        if (tool === undefined) {
          fail(`add_numbers was not offered (tools: ${tools.map((t) => t.name).join(', ')})`);
        }
        const result = await client.callTool('add_numbers', { a: 2, b: 3 });
        if (result.isError === true) {
          fail(`add_numbers call failed: ${JSON.stringify(result.content)}`);
        }
        process.stderr.write(`tools_call: ${JSON.stringify(result.content)}\n`);
      });
      return;
    }

    case 'elicitation-sep1034-client-defaults': {
      await withHttpClient(serverUrl, async (client) => {
        const tools = await client.listTools();
        if (!tools.some((candidate) => candidate.name === 'test_client_elicitation_defaults')) {
          fail('test_client_elicitation_defaults was not offered');
        }
        const result = await client.callTool('test_client_elicitation_defaults', {});
        if (result.isError === true) {
          fail(
            'the elicitation tool call failed — the engine has no elicitation ' +
              'consumer yet, so the server request cannot be answered (known gap)',
          );
        }
      });
      return;
    }

    case 'sse-retry': {
      const client = new SseMcpClient(sseConfig(serverUrl), {
        startupTimeoutMs: STARTUP_TIMEOUT_MS,
        toolCallTimeoutMs: TOOL_TIMEOUT_MS,
      });
      await client.connect();
      try {
        const tools = await client.listTools();
        process.stderr.write(`sse-retry: connected over SSE, ${String(tools.length)} tool(s)\n`);
        const tool = tools.find((candidate) => candidate.name === 'add_numbers');
        if (tool !== undefined) {
          const result = await client.callTool('add_numbers', { a: 4, b: 5 });
          process.stderr.write(`sse-retry: tool result isError=${String(result.isError)}\n`);
        }
      } finally {
        await client.close();
      }
      return;
    }

    case 'auth/metadata-default': {
      // No OAuth provider is wired: the server must answer 401 with
      // WWW-Authenticate. What happens next (metadata discovery or an
      // auth-required error) is the client stack's honest behavior — the
      // suite's server-side checks judge it.
      const client = new HttpMcpClient(httpConfig(serverUrl), {
        startupTimeoutMs: STARTUP_TIMEOUT_MS,
        toolCallTimeoutMs: TOOL_TIMEOUT_MS,
      });
      try {
        await client.connect();
        process.stderr.write('auth/metadata-default: connected without credentials\n');
        await client.close();
      } catch (error) {
        process.stderr.write(
          `auth/metadata-default: connect refused (${error instanceof Error ? error.message : String(error)})\n`,
        );
        process.exit(2);
      }
      return;
    }

    default: {
      fail(`unknown conformance scenario: ${scenario}`);
    }
  }
}

main().catch((error: unknown) => {
  fail(`adapter crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
