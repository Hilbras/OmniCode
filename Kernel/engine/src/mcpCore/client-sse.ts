import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js';

import { ErrorCodes, Error2 } from '#/errors';

import { buildMcpRemoteHeaders } from './client-remote';
import {
  buildRequestOptions,
  installToolListChangedHandler,
  OMNICODE_MCP_CLIENT_NAME,
  OMNICODE_MCP_CLIENT_VERSION,
  MCP_LIVENESS_PROBE_TIMEOUT_MS,
  toMcpToolDefinition,
  toMcpToolResult,
  type UnexpectedCloseListener,
  type UnexpectedCloseReason,
} from './client-shared';
import type { McpServerSseConfig } from './config-schema';
import { createMcpOAuthFetch } from './oauth/provider';
import { assertMcpEndpointAllowed, createMcpRedirectGuardFetch } from './remote-guard';
import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';

export interface SseMcpClientOptions {
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly startupTimeoutMs?: number;
  readonly toolCallTimeoutMs?: number;
  readonly envLookup?: (name: string) => string | undefined;
  readonly fetch?: typeof fetch;
  readonly oauthProvider?: OAuthClientProvider;
}

export class SseMcpClient implements MCPClient {
  private readonly client: Client;
  private readonly transport: SSEClientTransport;
  private readonly startupTimeoutMs?: number;
  private readonly toolCallTimeoutMs?: number;
  private started = false;
  private closed = false;
  private ready = false;
  private hooksInstalled = false;
  private unexpectedCloseListener: UnexpectedCloseListener | undefined;
  private lastTransportError: Error | undefined;
  private pendingUnexpectedClose: UnexpectedCloseReason | undefined;
  private unexpectedCloseFired = false;
  private toolsChangedListener: (() => void) | undefined;

  constructor(config: McpServerSseConfig, options: SseMcpClientOptions = {}) {
    const envLookup = options.envLookup ?? ((name) => process.env[name]);
    const headers = buildMcpRemoteHeaders(config, envLookup);
    const endpoint = assertMcpEndpointAllowed(config.url, {
      allowPrivateNetwork: config.allowPrivateNetwork,
    });

    this.transport = new SSEClientTransport(endpoint, {
      requestInit: headers !== undefined ? { headers } : undefined,
      fetch: createMcpRedirectGuardFetch(
        endpoint,
        createMcpOAuthFetch(options.oauthProvider, options.fetch),
      ),
      authProvider: options.oauthProvider,
    });
    this.client = new Client({
      name: options.clientName ?? OMNICODE_MCP_CLIENT_NAME,
      version: options.clientVersion ?? OMNICODE_MCP_CLIENT_VERSION,
    });
    this.startupTimeoutMs = options.startupTimeoutMs;
    this.toolCallTimeoutMs = options.toolCallTimeoutMs;
  }

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error2(ErrorCodes.MCP_STARTUP_FAILED, 'MCP SSE client is closed');
    }
    if (this.started) return;
    this.started = true;
    this.installTransportHooks();
    try {
      await this.client.connect(
        this.transport,
        buildRequestOptions(this.startupTimeoutMs, undefined),
      );
    } catch (error) {
      await this.closeStartedClient();
      throw error;
    }
    if (this.closed) {
      await this.closeStartedClient();
      throw new Error2(ErrorCodes.MCP_STARTUP_FAILED, 'MCP SSE client was closed during startup');
    }
    this.ready = true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.closeStartedClient();
  }

  onUnexpectedClose(listener: UnexpectedCloseListener): void {
    this.unexpectedCloseListener = listener;
    const pending = this.pendingUnexpectedClose;
    if (pending !== undefined) {
      this.pendingUnexpectedClose = undefined;
      listener(pending);
    }
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    const result = await this.client.listTools(
      undefined,
      buildRequestOptions(this.startupTimeoutMs, undefined),
    );
    return result.tools.map(toMcpToolDefinition);
  }

  onToolsChanged(listener: () => void): void {
    this.toolsChangedListener = listener;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<MCPToolResult> {
    const requestOptions = buildRequestOptions(this.toolCallTimeoutMs, signal);
    const result = await this.client.callTool({ name, arguments: args }, undefined, requestOptions);
    return toMcpToolResult(result);
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.client.ping(buildRequestOptions(MCP_LIVENESS_PROBE_TIMEOUT_MS, signal));
  }

  private async closeStartedClient(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.client.close();
  }

  private installTransportHooks(): void {
    if (this.hooksInstalled) return;
    this.hooksInstalled = true;
    installToolListChangedHandler(this.client, () => {
      this.toolsChangedListener?.();
    });
    this.client.onclose = () => {
      if (this.closed) return;
      if (!this.ready) return;
      this.fireUnexpectedClose({ error: this.lastTransportError });
    };
    this.client.onerror = (error) => {
      this.lastTransportError = error;
      if (this.closed) return;
      if (!this.ready) return;
      if (isTerminalSseTransportError(error)) {
        this.fireUnexpectedClose({ error });
      }
    };
  }

  private fireUnexpectedClose(reason: UnexpectedCloseReason): void {
    if (this.unexpectedCloseFired) return;
    this.unexpectedCloseFired = true;
    const listener = this.unexpectedCloseListener;
    if (listener !== undefined) {
      listener(reason);
    } else {
      this.pendingUnexpectedClose = reason;
    }
  }
}

export function isTerminalSseTransportError(error: Error): boolean {
  if (error.name === 'UnauthorizedError') return true;
  return error instanceof SseError && error.code !== undefined;
}
