import { readFile } from 'node:fs/promises';

import {
  ChannelConfigStore,
  ChannelSessionBindingService,
} from './binding';
import { executeChannelCommand, type ChannelCommandContext, type ChannelCommandResult } from './commands';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelKind,
  ChannelSendResult,
  ChannelSessionBinding,
  InboundChannelMessage,
  OutboundChannelMessage,
} from './contracts';
import { ChannelRegistry } from './registry';
import { TelegramChannelAdapter } from './adapters/telegram';
import {
  DingTalkChannelAdapter,
  FeishuChannelAdapter,
  SlackChannelAdapter,
  WeChatChannelAdapter,
} from './adapters/webhooks';
import type { ChannelHttpTransport } from './adapters/base';

export const DEFAULT_CHANNEL_CONFIG_FILE = 'channels.json';

export interface ChannelRuntimeAdapterConfig {
  readonly kind: ChannelKind;
  readonly enabled: boolean;
  readonly adapter: ChannelKind;
  readonly accountId?: string;
  readonly workspaceRoot?: string;
  readonly allowedConversations?: readonly string[];
  readonly botTokenEnv?: string;
  readonly webhookUrlEnv?: string;
}

export interface ChannelRuntimeFile {
  readonly channels?: readonly ChannelRuntimeAdapterConfig[];
}

export interface ChannelRuntimeOptions {
  readonly configs?: readonly ChannelRuntimeAdapterConfig[];
  readonly configPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: ChannelHttpTransport;
  readonly registry?: ChannelRegistry;
  readonly bindings?: ChannelSessionBindingService;
  readonly configStore?: ChannelConfigStore;
  readonly createAdapter?: (config: ChannelRuntimeAdapterConfig) => ChannelAdapter | undefined;
  readonly onMessage?: (message: InboundChannelMessage, binding: ChannelSessionBinding) => void | Promise<void>;
  readonly createSession?: ChannelCommandContext['createSession'];
  readonly stopSession?: ChannelCommandContext['stopSession'];
  readonly listSessions?: ChannelCommandContext['listSessions'];
}

export interface ChannelRuntimeStatus {
  readonly started: boolean;
  readonly adapters: readonly ChannelKind[];
  readonly errors: readonly string[];
}

export class ChannelRuntimeService {
  private readonly configs: readonly ChannelRuntimeAdapterConfig[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: ChannelHttpTransport | undefined;
  private readonly registry: ChannelRegistry;
  private readonly bindings: ChannelSessionBindingService;
  private readonly configStore: ChannelConfigStore;
  private readonly createAdapter: (config: ChannelRuntimeAdapterConfig) => ChannelAdapter | undefined;
  private readonly onMessage: ChannelRuntimeOptions['onMessage'];
  private readonly createSession: ChannelCommandContext['createSession'];
  private readonly stopSession: ChannelCommandContext['stopSession'];
  private readonly listSessions: ChannelCommandContext['listSessions'];
  private readonly errors: string[] = [];
  private started = false;

  constructor(options: ChannelRuntimeOptions = {}) {
    this.configs = options.configs ?? [];
    this.env = options.env ?? process.env;
    this.transport = options.transport;
    this.registry = options.registry ?? new ChannelRegistry();
    this.bindings = options.bindings ?? new ChannelSessionBindingService();
    this.configStore = options.configStore ?? new ChannelConfigStore();
    this.createAdapter = options.createAdapter ?? ((config) => this.createDefaultAdapter(config));
    this.onMessage = options.onMessage;
    this.createSession = options.createSession;
    this.stopSession = options.stopSession;
    this.listSessions = options.listSessions;
  }

  static async fromFile(path: string, options: Omit<ChannelRuntimeOptions, 'configs' | 'configPath'> = {}): Promise<ChannelRuntimeService> {
    return new ChannelRuntimeService({ ...options, configPath: path, configs: await loadChannelRuntimeConfig(path) });
  }

  async start(): Promise<ChannelRuntimeStatus> {
    if (this.started) return this.status();
    this.started = true;
    this.errors.length = 0;
    for (const config of this.configs) {
      const normalized: ChannelConfig = {
        kind: config.kind,
        enabled: config.enabled,
        ...(config.accountId === undefined ? {} : { accountId: config.accountId }),
        ...(config.workspaceRoot === undefined ? {} : { workspaceRoot: config.workspaceRoot }),
        ...(config.allowedConversations === undefined ? {} : { allowedConversations: config.allowedConversations }),
      };
      this.configStore.set(normalized);
      if (!config.enabled) continue;
      try {
        const adapter = this.createAdapter(config);
        if (adapter === undefined) {
          this.errors.push(`${config.kind}: adapter could not be created`);
          continue;
        }
        adapter.onMessage((message) => { void this.handleInbound(message); });
        this.registry.register(adapter);
        await adapter.start();
      } catch (error) {
        this.errors.push(`${config.kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this.status();
  }

  async stop(): Promise<void> {
    await this.registry.stopAll();
    this.started = false;
  }

  status(): ChannelRuntimeStatus {
    return { started: this.started, adapters: this.registry.list().map((adapter) => adapter.kind), errors: [...this.errors] };
  }

  bind(binding: Omit<ChannelSessionBinding, 'updatedAt'> & { readonly updatedAt?: number }): ChannelSessionBinding {
    return this.bindings.bind(binding);
  }

  unbind(channel: ChannelKind, conversationId: string): boolean {
    return this.bindings.unbind(channel, conversationId);
  }

  listBindings(channel?: ChannelKind): readonly ChannelSessionBinding[] {
    return this.bindings.list(channel);
  }

  async send(kind: ChannelKind, message: OutboundChannelMessage): Promise<ChannelSendResult> {
    return this.registry.send(kind, message);
  }

  async handleInbound(message: InboundChannelMessage): Promise<{ readonly handled: boolean; readonly command?: ChannelCommandResult }> {
    if (!this.configStore.allows(message.channel, message.conversationId)) {
      return { handled: false };
    }
    const command = await executeChannelCommand(message.text ?? '', {
      channel: message.channel,
      conversationId: message.conversationId,
      bindings: this.bindings,
      ...(this.createSession === undefined ? {} : { createSession: this.createSession }),
      ...(this.stopSession === undefined ? {} : { stopSession: this.stopSession }),
      ...(this.listSessions === undefined ? {} : { listSessions: this.listSessions }),
    });
    if (command.handled) {
      if (command.text.length > 0) await this.send(message.channel, { conversationId: message.conversationId, text: command.text });
      return { handled: true, command };
    }
    const binding = this.bindings.get(message.channel, message.conversationId);
    if (binding === undefined) {
      await this.send(message.channel, {
        conversationId: message.conversationId,
        text: 'No OmniCode session is bound to this conversation. Use /new or /bind <sessionId>.',
      });
      return { handled: true };
    }
    await this.onMessage?.(message, binding);
    return { handled: true };
  }

  private createDefaultAdapter(config: ChannelRuntimeAdapterConfig): ChannelAdapter | undefined {
    if (config.adapter === 'telegram') {
      const botToken = this.env[config.botTokenEnv ?? 'TELEGRAM_BOT_TOKEN'];
      return botToken === undefined || botToken.length === 0
        ? undefined
        : new TelegramChannelAdapter({ botToken, ...(this.transport === undefined ? {} : { transport: this.transport }) });
    }
    const endpoint = this.env[config.webhookUrlEnv ?? defaultWebhookEnv(config.adapter)];
    if (endpoint === undefined || endpoint.length === 0) return undefined;
    const options = { endpoint, ...(this.transport === undefined ? {} : { transport: this.transport }) };
    switch (config.adapter) {
      case 'dingtalk':
        return new DingTalkChannelAdapter(options);
      case 'wechat':
        return new WeChatChannelAdapter(options);
      case 'feishu':
        return new FeishuChannelAdapter(options);
      case 'slack':
        return new SlackChannelAdapter(options);
    }
  }
}

export async function loadChannelRuntimeConfig(path: string): Promise<readonly ChannelRuntimeAdapterConfig[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ChannelRuntimeFile;
    if (!Array.isArray(parsed.channels)) return [];
    return parsed.channels.filter(isRuntimeConfig);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

function isRuntimeConfig(value: unknown): value is ChannelRuntimeAdapterConfig {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['kind'] === 'string' &&
    typeof record['adapter'] === 'string' &&
    typeof record['enabled'] === 'boolean'
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function defaultWebhookEnv(kind: ChannelKind): string {
  switch (kind) {
    case 'dingtalk':
      return 'DINGTALK_WEBHOOK_URL';
    case 'wechat':
      return 'WECHAT_WEBHOOK_URL';
    case 'feishu':
      return 'FEISHU_WEBHOOK_URL';
    case 'slack':
      return 'SLACK_WEBHOOK_URL';
    case 'telegram':
      return 'TELEGRAM_BOT_TOKEN';
  }
}
