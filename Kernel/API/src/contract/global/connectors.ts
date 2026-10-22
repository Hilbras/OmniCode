/**
 * `connectorCatalogService` — the read-only integration catalog. Mirrors
 * `agent-core-v2/app/connectors/connectors.ts`; the entries are composed from
 * the real MCP management plane and the real plugin service, never a second
 * source of truth.
 *
 * `service` is the kind for first-party account connectors (GitHub, Vercel).
 * A first-party provider only appears once its authorization, credential
 * lifecycle, and agent tools exist, so the catalog never claims a provider
 * that cannot be used. GitHub appears while its experimental flag is on.
 */

import { z } from 'zod';

import type { ServiceContract } from '../types.js';

export const connectorKindSchema = z.enum(['mcp', 'plugin', 'service']);

export const connectorScopeSchema = z.enum(['user', 'workspace']);

export const connectorStatusSchema = z.enum([
  'active',
  'inactive',
  'needs-auth',
  'needs-trust',
  'not-configured',
  'unavailable',
  'expired',
  'error',
]);

export const connectorCapabilitySchema = z.enum(['tools', 'skills', 'commands', 'hooks']);

export const connectorActionSchema = z.enum([
  'open-mcp',
  'open-plugins',
  'connect-github',
  'disconnect-github',
  'connect-vercel',
  'disconnect-vercel',
]);

export const connectorEntrySchema = z.object({
  /** Stable identity of the integration (`mcp:<name>` / `plugin:<id>`). */
  id: z.string(),
  kind: connectorKindSchema,
  name: z.string(),
  description: z.string().optional(),
  /** Where the integration is configured: the account, or this workspace only. */
  scope: connectorScopeSchema,
  status: connectorStatusSchema,
  capabilities: z.array(connectorCapabilitySchema),
  actions: z.array(connectorActionSchema),
});

/**
 * `workspaceTrusted` decides whether a first-party provider may be connected
 * from this workspace: a provider connection is only offered in a trusted
 * workspace, and an absent value means no connect action is offered.
 */
export const connectorCatalogContract = {
  listConnectors: {
    input: z.tuple([
      z
        .object({
          cwd: z.string().min(1).optional(),
          workspaceTrusted: z.boolean().optional(),
        })
        .optional(),
    ]),
    output: z.array(connectorEntrySchema),
  },
} satisfies ServiceContract;
