import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getCoreVersion } from '@hilbras/omnicode-base/version';

import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';
import { McpUnsupportedError } from './resourceSurface';

export const OMNICODE_MCP_CLIENT_NAME = 'omnicode';
export const OMNICODE_MCP_CLIENT_VERSION = getCoreVersion();

export interface UnexpectedCloseReason {
  readonly error?: Error;
  readonly stderr?: string;
}

export type UnexpectedCloseListener = (reason: UnexpectedCloseReason) => void;

export function isMcpConnectionClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { readonly code?: unknown }).code === ErrorCode.ConnectionClosed
  );
}

export function isMcpTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isMcpConnectionClosedError(error)) return true;
  return !(error instanceof McpError);
}

export const MCP_LIVENESS_PROBE_TIMEOUT_MS = 5_000;

export function isMcpMalformedResultError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ZodError';
}

export function installToolListChangedHandler(client: Client, listener: () => void): void {
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    try {
      listener();
    } catch {}
  });
}

export async function probeMcpLiveness(client: MCPClient, signal: AbortSignal): Promise<boolean> {
  try {
    await client.ping(signal);
    return true;
  } catch (error) {
    if (isMcpConnectionClosedError(error)) return false;
    if (isMcpMalformedResultError(error)) return true;
    if (error instanceof McpError) {
      return (error as Error & { readonly code?: unknown }).code !== ErrorCode.RequestTimeout;
    }
    return false;
  }
}

export interface McpRequestOptions {
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

export function buildRequestOptions(
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): McpRequestOptions | undefined {
  if (timeoutMs === undefined && signal === undefined) return undefined;
  return { timeout: timeoutMs, signal };
}

interface SdkListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
}

export function toMcpToolDefinition(tool: SdkListedTool): MCPToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

const MCP_SDK_CAPABILITY_ERROR_PREFIX = 'Server does not support ';

/**
 * Servers that lack a resources/prompts capability answer the request with
 * JSON-RPC "Method not found", and the SDK also refuses such calls locally
 * with a plain Error under strict capability enforcement. Map both to the
 * typed McpUnsupportedError so callers get one unsupported shape for "this
 * server cannot answer this operation", not a generic failure.
 */
export function toMcpUnsupportedError(
  error: unknown,
  operation: McpUnsupportedError['operation'],
): unknown {
  if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) {
    return new McpUnsupportedError(operation);
  }
  if (error instanceof Error && error.message.startsWith(MCP_SDK_CAPABILITY_ERROR_PREFIX)) {
    return new McpUnsupportedError(operation);
  }
  return error;
}

export function toMcpToolResult(result: unknown): MCPToolResult {
  if (typeof result === 'object' && result !== null && 'content' in result) {
    const typed = result as {
      content: unknown;
      isError?: unknown;
      structuredContent?: unknown;
      _meta?: unknown;
    };
    if (Array.isArray(typed.content)) {
      return {
        content: typed.content as MCPToolResult['content'],
        isError: typed.isError === true,
        structuredContent: typed.structuredContent,
        _meta:
          typeof typed._meta === 'object' && typed._meta !== null
            ? (typed._meta as Record<string, unknown>)
            : undefined,
      };
    }
  }
  if (typeof result === 'object' && result !== null && 'toolResult' in result) {
    const legacy = (result as { toolResult: unknown }).toolResult;
    return {
      content: [
        {
          type: 'text',
          text: typeof legacy === 'string' ? legacy : JSON.stringify(legacy),
        },
      ],
      isError: false,
    };
  }
  return { content: [], isError: false };
}
