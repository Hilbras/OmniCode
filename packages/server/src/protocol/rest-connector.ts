import { z } from 'zod';

const ConnectorKind = z.enum(['mcp', 'plugin', 'service']);
const ConnectorScope = z.enum(['user', 'workspace']);
const ConnectorStatus = z.enum([
  'active',
  'inactive',
  'needs-auth',
  'needs-trust',
  'not-configured',
  'unavailable',
  'expired',
  'error',
]);
const ConnectorCapability = z.enum(['tools', 'skills', 'commands', 'hooks']);
const ConnectorAction = z.enum([
  'open-mcp',
  'open-plugins',
  'connect-github',
  'disconnect-github',
  'connect-vercel',
  'disconnect-vercel',
]);
const TelegramConnectorState = z.enum(['not-configured', 'awaiting-chat', 'ready']);

export const connectorEntrySchema = z.object({
  id: z.string(),
  kind: ConnectorKind,
  name: z.string(),
  description: z.string().optional(),
  scope: ConnectorScope,
  status: ConnectorStatus,
  capabilities: z.array(ConnectorCapability),
  actions: z.array(ConnectorAction),
});
export type ConnectorEntryWire = z.infer<typeof connectorEntrySchema>;

export const connectorsListQuerySchema = z.object({
  cwd: z.string().optional(),
});
export type ConnectorsListQuery = z.infer<typeof connectorsListQuerySchema>;

export const connectorsListResponseSchema = z.object({
  connectors: z.array(connectorEntrySchema),
});
export type ConnectorsListResponse = z.infer<typeof connectorsListResponseSchema>;

export const telegramStatusSchema = z.object({
  state: TelegramConnectorState,
  config_path: z.string(),
  has_token: z.boolean(),
  allowed_chat_ids: z.array(z.number()),
  running: z.boolean(),
  pid: z.number().optional(),
  heartbeat_at: z.number().optional(),
  bot: z
    .object({
      id: z.string(),
      username: z.string(),
      name: z.string(),
    })
    .optional(),
  error: z.string().optional(),
  last_update_at: z.number().optional(),
  last_error: z.string().optional(),
  bound_chats: z.number().optional(),
  started_at: z.number().optional(),
  uptime_ms: z.number().optional(),
  metrics: z
    .object({
      updates: z.number(),
      messages: z.number(),
      errors: z.number(),
    })
    .optional(),
  mode: z.enum(['polling', 'webhook']).optional(),
  webhook_url: z.string().optional(),
});
export type TelegramStatusWire = z.infer<typeof telegramStatusSchema>;

export const telegramStatusResponseSchema = z.object({
  telegram: telegramStatusSchema,
});
export type TelegramStatusResponse = z.infer<typeof telegramStatusResponseSchema>;

export const telegramHealthResponseSchema = z.object({
  healthy: z.boolean(),
  telegram: telegramStatusSchema,
});
export type TelegramHealthResponse = z.infer<typeof telegramHealthResponseSchema>;

export const telegramSettingsRequestSchema = z.object({
  botToken: z.string().optional(),
  allowedChatIds: z.array(z.number()).optional(),
  mode: z.enum(['polling', 'webhook']).optional(),
  webhookUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
});

export const telegramWebhookResponseSchema = z.object({
  ok: z.boolean(),
});
export type TelegramWebhookResponse = z.infer<typeof telegramWebhookResponseSchema>;
export type TelegramSettingsRequest = z.infer<typeof telegramSettingsRequestSchema>;
