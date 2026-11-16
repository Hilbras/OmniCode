/**
 * `githubService` — the first-party GitHub account connector. The catalog
 * entry for a provider only becomes actionable once its authorization,
 * credential lifecycle, and agent tools exist; those live in
 * `agent-core-v2/app/github/`.
 *
 * The device flow never exposes GitHub's device code to a client: the core
 * service keeps the pending flow and hands out an opaque flow id, the same
 * shape the MCP management plane uses for its authorization flows.
 */

import { z } from 'zod';

import type { ServiceContract } from '../types.js';

export const githubRepositoryAccessSchema = z.enum(['none', 'all', 'selected']);

export const githubConnectionStatusSchema = z.object({
  /** Whether a client id is configured, so a connection can be started. */
  configured: z.boolean(),
  connected: z.boolean(),
  /** The authorized account, when a credential is stored. */
  accountLogin: z.string().optional(),
  scopes: z.array(z.string()),
  expiresAt: z.number().optional(),
  expired: z.boolean(),
  repositoryAccess: githubRepositoryAccessSchema,
  repositories: z.array(z.string()),
});

export const githubDeviceFlowStartSchema = z.object({
  /** Opaque handle for the pending authorization; the device code stays in core. */
  flowId: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string().optional(),
  expiresInSeconds: z.number(),
  intervalSeconds: z.number(),
  scopes: z.array(z.string()),
});

export const githubConnectResultSchema = z.union([
  z.object({ kind: z.literal('pending') }),
  z.object({ kind: z.literal('slow_down') }),
  z.object({ kind: z.literal('connected'), status: githubConnectionStatusSchema }),
]);

export const githubDisconnectResultSchema = z.object({
  disconnected: z.boolean(),
  /** Whether the grant was also revoked at the provider. */
  providerRevoked: z.boolean(),
  message: z.string(),
});

export const githubContract = {
  status: {
    input: z.tuple([]),
    output: githubConnectionStatusSchema,
  },
  startDeviceFlow: {
    input: z.tuple([]),
    output: githubDeviceFlowStartSchema,
  },
  pollDeviceFlow: {
    input: z.tuple([z.string().min(1)]),
    output: githubConnectResultSchema,
  },
  disconnect: {
    input: z.tuple([]),
    output: githubDisconnectResultSchema,
  },
} satisfies ServiceContract;
