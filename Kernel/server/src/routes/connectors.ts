import {
  IConnectorCatalogService,
  ITelegramConnectorService,
  IWorkspaceInstanceManager,
  type ConnectorEntry,
  type Scope,
  type TelegramConnectorStatus,
} from '@hilbras/omnicode-core';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  connectorsListQuerySchema,
  connectorsListResponseSchema,
  telegramSettingsRequestSchema,
  telegramStatusResponseSchema,
  type ConnectorEntryWire,
  type TelegramStatusWire,
} from '../protocol/rest-connector';

interface ConnectorsRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; query: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  put(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerConnectorsRoutes(app: ConnectorsRouteHost, core: Scope): void {
  const listRoute = defineRoute(
    {
      method: 'GET',
      path: '/connectors',
      querystring: connectorsListQuerySchema,
      success: { data: connectorsListResponseSchema },
      description: 'List the integration connectors visible to the server',
      tags: ['connectors'],
      operationId: 'listConnectors',
    },
    async (req, reply) => {
      const connectors = await listConnectors(core, req.query.cwd);
      reply.send(okEnvelope({ connectors: connectors.map(toWireConnector) }, req.id));
    },
  );
  app.get(
    listRoute.path,
    listRoute.options,
    listRoute.handler as Parameters<ConnectorsRouteHost['get']>[2],
  );

  const statusRoute = defineRoute(
    {
      method: 'GET',
      path: '/connectors/telegram',
      success: { data: telegramStatusResponseSchema },
      description: 'Read the Telegram connector status',
      tags: ['connectors'],
      operationId: 'getTelegramConnector',
    },
    async (req, reply) => {
      const status = await core.accessor.get(ITelegramConnectorService).status();
      reply.send(okEnvelope({ telegram: toWireTelegram(status) }, req.id));
    },
  );
  app.get(
    statusRoute.path,
    statusRoute.options,
    statusRoute.handler as Parameters<ConnectorsRouteHost['get']>[2],
  );

  const saveRoute = defineRoute(
    {
      method: 'PUT',
      path: '/connectors/telegram',
      body: telegramSettingsRequestSchema,
      success: { data: telegramStatusResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Save the Telegram bot token and the chat ids allowed to drive sessions',
      tags: ['connectors'],
      operationId: 'saveTelegramConnector',
    },
    async (req, reply) => {
      const { botToken, allowedChatIds } = req.body;
      if (botToken === undefined && allowedChatIds === undefined) {
        reply.send(
          errEnvelope(
            ErrorCode.VALIDATION_FAILED,
            'Provide a bot token or at least one allowed chat id',
            req.id,
          ),
        );
        return;
      }
      const status = await core.accessor
        .get(ITelegramConnectorService)
        .saveSettings({ botToken, allowedChatIds });
      reply.send(okEnvelope({ telegram: toWireTelegram(status) }, req.id));
    },
  );
  app.put(
    saveRoute.path,
    saveRoute.options,
    saveRoute.handler as Parameters<ConnectorsRouteHost['put']>[2],
  );

  const verifyRoute = defineRoute(
    {
      method: 'POST',
      path: '/connectors/telegram/verify',
      success: { data: telegramStatusResponseSchema },
      description: 'Probe the Telegram bot token against the Telegram API',
      tags: ['connectors'],
      operationId: 'verifyTelegramConnector',
    },
    async (req, reply) => {
      const status = await core.accessor.get(ITelegramConnectorService).status({ probe: true });
      reply.send(okEnvelope({ telegram: toWireTelegram(status) }, req.id));
    },
  );
  app.post(
    verifyRoute.path,
    verifyRoute.options,
    verifyRoute.handler as Parameters<ConnectorsRouteHost['post']>[2],
  );
}

async function listConnectors(
  core: Scope,
  cwd: string | undefined,
): Promise<readonly ConnectorEntry[]> {
  const catalog = core.accessor.get(IConnectorCatalogService);
  if (cwd === undefined) return catalog.listConnectors({});
  const handler = await core.accessor.get(IWorkspaceInstanceManager).getOrCreate({ root: cwd });
  const workspaceTrusted = await handler.program.trust.get();
  return catalog.listConnectors({ cwd: handler.root, workspaceTrusted });
}

function toWireConnector(entry: ConnectorEntry): ConnectorEntryWire {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    scope: entry.scope,
    status: entry.status,
    capabilities: [...entry.capabilities],
    actions: [...entry.actions],
  };
}

function toWireTelegram(status: TelegramConnectorStatus): TelegramStatusWire {
  return {
    state: status.state,
    config_path: status.configPath,
    has_token: status.hasToken,
    allowed_chat_ids: [...status.allowedChatIds],
    running: status.running,
    pid: status.pid,
    heartbeat_at: status.heartbeatAt,
    bot:
      status.bot === undefined
        ? undefined
        : { id: status.bot.id, username: status.bot.username, name: status.bot.name },
    error: status.error,
  };
}
