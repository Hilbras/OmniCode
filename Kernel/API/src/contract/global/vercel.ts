/**
 * `vercelService` — the first-party Vercel account connector. Vercel has no
 * OAuth device flow for account access: the connector uses a Vercel access
 * token, taken from `vercel.token` / `OMNICODE_VERCEL_TOKEN` or supplied at
 * connect time. The token is never returned to a client.
 *
 * The engine implementation lives in `agent-core-v2/app/vercel/`.
 */

import { z } from 'zod';

import type { ServiceContract } from '../types.js';

export const vercelScopeTypeSchema = z.enum(['user', 'team']);

export const vercelConnectionStatusSchema = z.object({
  /** Whether a token is available, so a connection can be established. */
  configured: z.boolean(),
  connected: z.boolean(),
  accountId: z.string().optional(),
  accountType: vercelScopeTypeSchema.optional(),
  accountSlug: z.string().optional(),
  accountName: z.string().optional(),
  username: z.string().optional(),
  scopes: z.array(z.string()),
  expiresAt: z.number().optional(),
  expired: z.boolean(),
});

export const vercelConnectResultSchema = z.object({
  connected: z.boolean(),
  status: vercelConnectionStatusSchema,
  message: z.string(),
});

export const vercelDisconnectResultSchema = z.object({
  disconnected: z.boolean(),
  message: z.string(),
});

export const vercelContract = {
  status: {
    input: z.tuple([]),
    output: vercelConnectionStatusSchema,
  },
  connect: {
    input: z.tuple([z.string().min(1).optional()]),
    output: vercelConnectResultSchema,
  },
  disconnect: {
    input: z.tuple([]),
    output: vercelDisconnectResultSchema,
  },
} satisfies ServiceContract;
