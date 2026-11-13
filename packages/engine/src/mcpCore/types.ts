import { ErrorCodes, Error2 } from '#/errors';
import type { McpPage, McpPromptDescriptor, McpResourceDescriptor } from './resourceSurface';

export interface MCPEmbeddedResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  [key: string]: unknown;
}

export interface MCPContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  resource?: MCPEmbeddedResourceContents;
  [key: string]: unknown;
}

export interface MCPToolResult {
  content: MCPContentBlock[];
  isError: boolean;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}

export interface MCPToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  readonly annotations?: MCPToolAnnotations;
}

export interface MCPResourceContents {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
}

export interface MCPClient {
  listTools(): Promise<MCPToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<MCPToolResult>;
  ping(signal?: AbortSignal): Promise<void>;
  onToolsChanged?(listener: () => void): void;
  listResources?(cursor?: string): Promise<McpPage<McpResourceDescriptor>>;
  readResource?(uri: string): Promise<readonly MCPResourceContents[]>;
  listPrompts?(cursor?: string): Promise<McpPage<McpPromptDescriptor>>;
  getPrompt?(
    name: string,
    args: Readonly<Record<string, string>>,
  ): Promise<{
    readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  }>;
  /** Raw capability names the server advertised at initialize; [] before connect. */
  advertisedCapabilities?(): readonly string[];
}

export function assertMcpInputSchema(
  toolName: string,
  inputSchema: unknown,
): Record<string, unknown> {
  if (typeof inputSchema === 'object' && inputSchema !== null && !Array.isArray(inputSchema)) {
    return inputSchema as Record<string, unknown>;
  }
  throw new Error2(
    ErrorCodes.MCP_STARTUP_FAILED,
    `Invalid inputSchema for MCP tool "${toolName}": schema must be a JSON object`,
  );
}
