import { join } from 'node:path';

import {
  ChannelRuntimeService,
  ChannelSessionBindingService,
  FileChannelBindingPersistence,
  loadChannelRuntimeConfig,
  type ChannelKind,
} from '@hilbras/omnicode-api';
import type { OmnicodeHarness, Session } from '@hilbras/omnicode-sdk';

type HarnessWithSessions = OmnicodeHarness;
type ChannelRuntimeHandlers = NonNullable<ConstructorParameters<typeof ChannelRuntimeService>[0]>['onMessage'];

export interface ConfiguredChannelRuntime {
  readonly runtime: ChannelRuntimeService;
  stop(): Promise<void>;
}

export async function startConfiguredChannelRuntime(
  harness: HarnessWithSessions,
  options: {
    readonly configPath?: string;
    readonly bindingsPath?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ConfiguredChannelRuntime | undefined> {
  const configPath = options.configPath ?? join(harness.homeDir, 'channels.json');
  const configs = await loadChannelRuntimeConfig(configPath);
  if (configs.length === 0) return undefined;
  const bindings = new ChannelSessionBindingService({
    persistence: new FileChannelBindingPersistence(
      options.bindingsPath ?? join(harness.homeDir, 'channel-bindings.json'),
    ),
  });
  await bindings.load();

  let runtime: ChannelRuntimeService;
  const sessions = new Map<string, Session>();
  const subscriptions = new Map<string, () => void>();
  const buffers = new Map<string, string>();

  const sessionFor = async (sessionId: string): Promise<Session> => {
    const known = sessions.get(sessionId);
    if (known !== undefined && !known.isClosed) return known;
    const active = harness.sessions.get(sessionId);
    if (active !== undefined && !active.isClosed) {
      sessions.set(sessionId, active);
      return active;
    }
    const resumed = await harness.resumeSession({ id: sessionId });
    sessions.set(sessionId, resumed);
    return resumed;
  };

  const onMessage: ChannelRuntimeHandlers = async (message, binding) => {
    const session = await sessionFor(binding.sessionId);
    if (!subscriptions.has(session.id)) {
      const unsubscribe = session.onEvent((event) => {
        if (event.type === 'assistant.delta') {
          buffers.set(String(event.turnId), `${buffers.get(String(event.turnId)) ?? ''}${event.delta}`);
          return;
        }
        if (event.type === 'turn.ended') {
          const key = String(event.turnId);
          const text = buffers.get(key)?.trim();
          buffers.delete(key);
          if (text !== undefined && text.length > 0) {
            void runtime.send(message.channel, { conversationId: message.conversationId, text });
          }
        }
      });
      subscriptions.set(session.id, unsubscribe);
    }
    await session.prompt(message.text ?? '');
  };

  runtime = new ChannelRuntimeService({
    configs,
    env: options.env,
    bindings,
    security: {
      providerSecrets: providerSecretsFromEnv(options.env),
      requireSignature: options.env?.['OMNICODE_CHANNELS_REQUIRE_SIGNATURE'] !== '0',
    },
    createSession: async (input) => {
      const session = await harness.createSession({
        workDir: input.workspaceRoot ?? process.cwd(),
      });
      sessions.set(session.id, session);
      return { sessionId: session.id, workspaceRoot: session.workDir };
    },
    stopSession: async (sessionId) => {
      const session = await sessionFor(sessionId);
      await session.close();
      sessions.delete(sessionId);
      subscriptions.get(sessionId)?.();
      subscriptions.delete(sessionId);
      return true;
    },
    listSessions: async () => [...harness.sessions.values()].map((session) => ({ sessionId: session.id, workspaceRoot: session.workDir })),
    onMessage,
  });
  const status = await runtime.start();
  if (status.errors.length > 0) {
    await runtime.stop();
    throw new Error(`channel runtime failed: ${status.errors.join('; ')}`);
  }
  return {
    runtime,
    stop: async () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
      await runtime.stop();
      await bindings.flush();
    },
  };
}

function providerSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<ChannelKind, string>> {
  return {
    ...(env['TELEGRAM_WEBHOOK_SECRET'] === undefined ? {} : { telegram: env['TELEGRAM_WEBHOOK_SECRET'] }),
    ...(env['SLACK_SIGNING_SECRET'] === undefined ? {} : { slack: env['SLACK_SIGNING_SECRET'] }),
    ...(env['WECHAT_WEBHOOK_SECRET'] === undefined ? {} : { wechat: env['WECHAT_WEBHOOK_SECRET'] }),
    ...(env['DINGTALK_WEBHOOK_SECRET'] === undefined ? {} : { dingtalk: env['DINGTALK_WEBHOOK_SECRET'] }),
    ...(env['FEISHU_WEBHOOK_SECRET'] === undefined ? {} : { feishu: env['FEISHU_WEBHOOK_SECRET'] }),
  };
}
