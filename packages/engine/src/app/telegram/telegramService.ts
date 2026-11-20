import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve, sep } from 'node:path';
import { hostname } from 'node:os';

import {
  ScopeActivation,
  registerScopedService,
  type ISessionScopeHandle,
} from '@hilbras/omnicode-base/di/scope';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { ISessionManager } from '#/app/sessionManager/sessionManager';
import { IWorkspaceService } from '#/app/workspace/workspace';
import type { ContentPart } from '#/human/llm/message';
import type { UserPromptOrigin } from '#/human/agent/origin';
import { buildDaemonFileUrl } from '#/agent/media/mediaRef';
import { ISessionMediaStore } from '#/agent/media/sessionMediaStore';
import { IEventBus } from '#/app/event/eventBus';
import { interactions } from '#/human/interaction/facade';
import { INTERACTION_TAG_SESSION_ID } from '#/human/interaction/interaction';
import { IAgentFullCompactionService } from '#/agent/fullCompaction/fullCompaction';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type { PermissionMode } from '#/agent/permissionPolicy/types';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IModelCatalog } from '#/llm-adapter/model/catalog';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ensureMainAgent } from '#/session/agentLifecycle/mainAgent';
import { LifecycleScope } from '#/app/scopes';

import { ITelegramConnectorService, type TelegramStatusOptions } from './telegram';
import { splitMarkdownChunks, telegramHtmlBody } from './markdown';
import type {
  TelegramBotIdentity,
  TelegramChatBinding,
  TelegramConnectorState,
  TelegramConnectorStatus,
  TelegramMetrics,
  TelegramPairingCode,
  TelegramSettingsInput,
} from './types';

const CONFIG_FILE = 'telegram.json';
const STATE_FILE = 'telegram-state.json';
const BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN';
const HEARTBEAT_STALE_MS = 90_000;
const PROBE_TIMEOUT_MS = 20_000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const UPDATE_TIMEOUT_SECONDS = 25;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

let retrySink: ((record: Record<string, unknown>) => void) | undefined;
let retryMetricSink: (() => void) | undefined;

interface TelegramLifecycle {
  readonly running: boolean;
  readonly pid?: number;
  readonly heartbeatAt?: number;
}

interface TelegramProbe {
  readonly bot?: TelegramBotIdentity;
  readonly error?: string;
}

export class TelegramConnectorService implements ITelegramConnectorService {
  declare readonly _serviceBrand: undefined;

  private loopAbort: AbortController | undefined;
  private readonly seenUpdateIds = new Set<number>();
  private readonly chatQueues = new Map<number, Promise<void>>();
  private readonly pairingFailures = new Map<number, { count: number; blockedUntil: number }>();
  private metricWrites: Promise<void> = Promise.resolve();
  private interactionUnsubscribe: (() => void) | undefined;
  private readonly handledInteractions = new Set<string>();
  private readonly questionFlows = new Map<string, TelegramQuestionFlow>();
  private readonly pendingTextReplies = new Map<number, TelegramPendingTextReply>();
  private readonly pendingSessionPicks = new Map<
    number,
    { readonly message: NonNullable<TelegramUpdate['message']>; readonly at: number }
  >();
  private readonly mediaGroups = new Map<
    string,
    {
      readonly token: string;
      readonly chatId: number;
      readonly messages: NonNullable<TelegramUpdate['message']>[];
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IWorkspaceService private readonly workspaces: IWorkspaceService,
    @ISessionManager private readonly sessions: ISessionManager,
  ) {
    retrySink = (record) => {
      void this.persistRetry(record);
    };
    retryMetricSink = () => {
      void this.bumpMetric('retries');
    };
  }

  private async persistRetry(record: Record<string, unknown>): Promise<void> {
    try {
      await appendFile(
        join(this.bootstrap.homeDir, 'telegram-retry.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
        { mode: 0o600 },
      );
    } catch {
      /* retry logging is best-effort */
    }
  }

  private get configPath(): string {
    return join(this.bootstrap.homeDir, CONFIG_FILE);
  }

  private get statePath(): string {
    return join(this.bootstrap.homeDir, STATE_FILE);
  }

  private get lockPath(): string {
    return join(this.bootstrap.homeDir, 'telegram.lock');
  }

  async status(options: TelegramStatusOptions = {}): Promise<TelegramConnectorStatus> {
    const config = await this.readSecureConfig();
    const token = await this.tokenFor(config);
    const allowedChatIds = readChatIds(config?.['allowedChatIds']);
    const lifecycle = await this.readLifecycle();
    const state = await readJsonObject(this.statePath);
    const base: TelegramConnectorStatus = {
      state: connectorState(token !== '', allowedChatIds),
      configPath: this.configPath,
      hasToken: token !== '',
      allowedChatIds,
      running: lifecycle.running,
      pid: lifecycle.pid,
      heartbeatAt: lifecycle.heartbeatAt,
      lastUpdateAt: readNumber(state?.['lastUpdateAt']),
      lastError: readString(state?.['lastError']),
      pairing: readPairing(config?.['pairing']),
      boundChats: Object.keys(readBindings(config?.['bindings'])).length,
      startedAt: readNumber(state?.['startedAt']),
      uptimeMs:
        readNumber(state?.['startedAt']) === undefined
          ? undefined
          : Date.now() - readNumber(state?.['startedAt'])!,
      metrics: readMetrics(state?.['metrics']),
      mode: readString(config?.['mode']) === 'webhook' ? 'webhook' : 'polling',
      webhookUrl: readString(config?.['webhookUrl']),
    };
    if (options.probe !== true || token === '') return base;
    const probe = await probeBot(token);
    return { ...base, bot: probe.bot, error: probe.error };
  }

  async saveSettings(input: TelegramSettingsInput): Promise<TelegramConnectorStatus> {
    const config = (await this.readSecureConfig()) ?? {};
    const next: Record<string, unknown> = { ...config };
    if (input.botToken !== undefined) {
      const encrypted = await this.encryptToken(input.botToken.trim());
      Object.assign(next, encrypted);
      delete next['botToken'];
    }
    if (input.allowedChatIds !== undefined) next['allowedChatIds'] = [...input.allowedChatIds];
    if (input.mode !== undefined) next['mode'] = input.mode;
    if (input.webhookUrl !== undefined) next['webhookUrl'] = input.webhookUrl;
    if (input.webhookSecret !== undefined) next['webhookSecret'] = input.webhookSecret;
    if (input.showMcpCalls !== undefined) next['showMcpCalls'] = input.showMcpCalls;
    await writeJson(this.configPath, next);
    return this.status();
  }

  async listBindings(): Promise<Readonly<Record<string, TelegramChatBinding>>> {
    const config = await readJsonObject(this.configPath);
    return readBindings(config?.['bindings']);
  }

  async unbindChat(chatId: number): Promise<TelegramConnectorStatus> {
    const config = (await readJsonObject(this.configPath)) ?? {};
    const bindings = { ...readBindings(config['bindings']) };
    delete bindings[String(chatId)];
    await writeJson(this.configPath, { ...config, bindings });
    return this.status();
  }

  async bindChat(chatId: number, binding: TelegramChatBinding): Promise<void> {
    const config = (await readJsonObject(this.configPath)) ?? {};
    const bindings = { ...readBindings(config['bindings']), [String(chatId)]: binding };
    await writeJson(this.configPath, { ...config, bindings });
  }

  private async bindingFor(chatId: number): Promise<TelegramChatBinding | undefined> {
    const config = await readJsonObject(this.configPath);
    return readBindings(config?.['bindings'])[String(chatId)];
  }

  private async latestSession(): Promise<ISessionScopeHandle | undefined> {
    let best: { readonly handle: ISessionScopeHandle; readonly updatedAt: number } | undefined;
    for (const handle of this.sessions.list()) {
      try {
        const meta = await handle.accessor.get(ISessionMetadata).read();
        if (meta.archived) continue;
        if (best === undefined || meta.updatedAt > best.updatedAt) {
          best = { handle, updatedAt: meta.updatedAt };
        }
      } catch {
        /* a session without readable metadata cannot be the default */
      }
    }
    return best?.handle;
  }

  private async sendSessionPicker(
    token: string,
    chatId: number,
    headline: string,
    emptyMessage: string,
  ): Promise<void> {
    const handles = this.sessions.list().slice(0, 10);
    if (handles.length === 0) {
      await sendMessage(token, chatId, emptyMessage);
      return;
    }
    const current = await this.bindingFor(chatId);
    const rows: { text: string; callback_data: string }[][] = [];
    for (const handle of handles) {
      const context = handle.accessor.get(ISessionContext);
      let title = context.sessionId;
      try {
        const meta = await handle.accessor.get(ISessionMetadata).read();
        if (meta.title !== undefined && meta.title.trim().length > 0) title = meta.title;
      } catch {
        /* title is optional */
      }
      const marker = current?.sessionId === context.sessionId ? '✓ ' : '';
      rows.push([
        {
          text: `${marker}${title}`.slice(0, 60),
          callback_data: `s:${context.sessionId}`,
        },
      ]);
    }
    rows.push([{ text: '➕ Start new session', callback_data: 'n:new' }]);
    await sendInlineKeyboard(token, chatId, headline, rows);
  }

  private takePendingPick(
    chatId: number,
  ): NonNullable<TelegramUpdate['message']> | undefined {
    const pick = this.pendingSessionPicks.get(chatId);
    this.pendingSessionPicks.delete(chatId);
    if (pick === undefined) return undefined;
    if (Date.now() - pick.at > PAIRING_TTL_MS) return undefined;
    return pick.message;
  }

  private async routeBoundPrompt(
    token: string,
    chatId: number,
    binding: TelegramChatBinding,
    message: NonNullable<TelegramUpdate['message']>,
  ): Promise<void> {
    try {
      const text = (message.text ?? message.caption ?? '').trim();
      const attachments = await this.collectAttachments(token, chatId, message, binding.sessionId);
      this.enqueuePrompt(
        token,
        chatId,
        binding.sessionId,
        text.length > 0 ? text : 'Please analyze the attached content.',
        attachments,
        message.message_id,
      );
    } catch (error) {
      await sendMessage(token, chatId, `Session error: ${errorMessage(error)}`);
    }
  }

  private async createSessionForChat(chatId: number): Promise<TelegramChatBinding> {
    const existing = await this.bindingFor(chatId);
    const workspaceRoot = existing?.workspaceRoot ?? process.cwd();
    const workspace = await this.workspaces.createOrTouch(workspaceRoot);
    const handle = await this.sessions.create({
      workspaceId: workspace.id,
      workDir: workspaceRoot,
    });
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await handle.accessor.get(ISessionMetadata).setTitle(`Telegram ${stamp}`);
    } catch {
      /* title is cosmetic */
    }
    const binding: TelegramChatBinding = {
      sessionId: handle.accessor.get(ISessionContext).sessionId,
      workspaceRoot,
      updatedAt: Date.now(),
      permission: existing?.permission ?? 'manual',
    };
    await this.bindChat(chatId, binding);
    return binding;
  }

  private async readSecureConfig(): Promise<Record<string, unknown> | undefined> {
    const config = await readJsonObject(this.configPath);
    if (config === undefined) return undefined;
    const plain = config['botToken'];
    if (typeof plain !== 'string' || plain.trim() === '') return config;
    const encrypted = await this.encryptToken(plain.trim());
    const next: Record<string, unknown> = { ...config, ...encrypted };
    delete next['botToken'];
    await writeJson(this.configPath, next);
    return next;
  }

  private async tokenFor(config: Record<string, unknown> | undefined): Promise<string> {
    const fromEnv = process.env[BOT_TOKEN_ENV];
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
    const encrypted = config?.['botTokenEncrypted'];
    const iv = config?.['botTokenIv'];
    const tag = config?.['botTokenTag'];
    if (typeof encrypted === 'string' && typeof iv === 'string' && typeof tag === 'string') {
      return this.decryptToken(encrypted, iv, tag);
    }
    const plain = config?.['botToken'];
    return typeof plain === 'string' ? plain.trim() : '';
  }

  private async key(): Promise<Buffer> {
    const path = join(this.bootstrap.homeDir, '.telegram-key');
    try {
      const key = await readFile(path);
      if (key.length === 32) return key;
    } catch {
      /* create below */
    }
    const key = randomBytes(32);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, key, { mode: 0o600 });
    return key;
  }

  private async encryptToken(
    token: string,
  ): Promise<{ botTokenEncrypted: string; botTokenIv: string; botTokenTag: string }> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return {
      botTokenEncrypted: encrypted.toString('base64'),
      botTokenIv: iv.toString('base64'),
      botTokenTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private async decryptToken(encrypted: string, iv: string, tag: string): Promise<string> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await this.key(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  async createPairingCode(): Promise<TelegramPairingCode> {
    const config = (await this.readSecureConfig()) ?? {};
    const token = await this.tokenFor(config);
    if (token === '') throw new Error('Telegram bot token is not configured.');
    const existing = readPairing(config['pairing']);
    const probe = await probeBot(token);
    const code = existing?.code ?? randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = existing?.expiresAt ?? Date.now() + PAIRING_TTL_MS;
    if (existing === undefined) {
      const next = { ...config, pairing: { code, expiresAt } };
      await writeJson(this.configPath, next);
    }
    await this.audit('pairing.created', { code, expiresAt });
    return {
      code,
      expiresAt,
      deepLink:
        probe.bot?.username === undefined || probe.bot.username === ''
          ? undefined
          : `https://t.me/${probe.bot.username}?start=${code}`,
    };
  }

  async start(): Promise<TelegramConnectorStatus> {
    if (this.loopAbort !== undefined) return this.status();
    const config = await this.readSecureConfig();
    const token = await this.tokenFor(config);
    if (token === '') throw new Error('Telegram bot token is not configured.');
    await this.acquireLock();
    try {
      const abort = new AbortController();
      this.loopAbort = abort;
      await writeTelegramState(this.statePath, {
        running: true,
        pid: process.pid,
        heartbeatAt: Date.now(),
        startedAt: Date.now(),
        metrics: { updates: 0, messages: 0, errors: 0 },
      });
      this.interactionUnsubscribe?.();
      this.interactionUnsubscribe = interactions.onDidChangePending(() => {
        void this.syncPendingInteractions();
      });
      void this.syncPendingInteractions();
      const mode = readString(config?.['mode']) === 'webhook' ? 'webhook' : 'polling';
      if (mode === 'webhook') {
        const webhookUrl = readString(config?.['webhookUrl']);
        if (webhookUrl === undefined || webhookUrl.trim() === '') {
          throw new Error('Telegram webhook URL is not configured.');
        }
        const webhookSecret = readString(config?.['webhookSecret']);
        if (webhookSecret === undefined || webhookSecret.length === 0) {
          throw new Error('Telegram webhook mode requires a webhook secret.');
        }
        await callTelegramApi(token, 'setWebhook', {
          url: webhookUrl,
          secret_token: webhookSecret,
        });
        await this.audit('bot.start', { mode });
        return this.status();
      }
      await this.audit('bot.start', { mode });
      void this.supervise(token, abort.signal);
      void this.registerBotCommands(token).catch(() => undefined);
      return this.status();
    } catch (error) {
      this.loopAbort = undefined;
      await this.releaseLock();
      throw error;
    }
  }

  async stop(): Promise<TelegramConnectorStatus> {
    this.loopAbort?.abort();
    this.loopAbort = undefined;
    this.interactionUnsubscribe?.();
    this.interactionUnsubscribe = undefined;
    this.handledInteractions.clear();
    const config = await this.readSecureConfig();
    const token = await this.tokenFor(config);
    if (readString(config?.['mode']) === 'webhook' && token !== '') {
      await callTelegramApi(token, 'deleteWebhook', {}).catch(() => undefined);
    }
    for (const group of this.mediaGroups.values()) clearTimeout(group.timer);
    this.mediaGroups.clear();
    await writeTelegramState(this.statePath, {
      running: false,
      heartbeatAt: Date.now(),
    });
    await this.audit('bot.stop', {});
    await this.releaseLock();
    return this.status();
  }

  async handleWebhookUpdate(update: unknown, secret: string | undefined): Promise<boolean> {
    const config = await this.readSecureConfig();
    const token = await this.tokenFor(config);
    if (token === '') return false;
    if (readString(config?.['mode']) !== 'webhook') return false;
    const expected = readString(config?.['webhookSecret']);
    if (expected === undefined || expected.length === 0) return false;
    if (!secretsMatch(expected, secret)) return false;
    const record = asRecord(update);
    const updateId = record['update_id'];
    if (typeof updateId !== 'number') return false;
    if (this.seenUpdateIds.has(updateId)) return true;
    await this.bumpMetric('updates');
    if (record['message'] !== undefined || record['callback_query'] !== undefined) {
      await this.bumpMetric('messages');
    }
    await this.handleUpdate(token, record as unknown as TelegramUpdate);
    this.rememberUpdate(updateId);
    await writeTelegramState(this.statePath, {
      lastUpdateAt: Date.now(),
      lastError: undefined,
    });
    return true;
  }

  private rememberUpdate(updateId: number): void {
    this.seenUpdateIds.add(updateId);
    if (this.seenUpdateIds.size > 2_000) {
      const oldest = this.seenUpdateIds.values().next().value;
      if (oldest !== undefined) this.seenUpdateIds.delete(oldest);
    }
  }

  async addAllowedChat(chatId: number): Promise<TelegramConnectorStatus> {
    const config = (await readJsonObject(this.configPath)) ?? {};
    const ids = readChatIds(config['allowedChatIds']);
    if (!ids.includes(chatId)) ids.push(chatId);
    await writeJson(this.configPath, { ...config, allowedChatIds: ids });
    return this.status();
  }

  async removeAllowedChat(chatId: number): Promise<TelegramConnectorStatus> {
    const config = (await readJsonObject(this.configPath)) ?? {};
    const ids = readChatIds(config['allowedChatIds']).filter((id) => id !== chatId);
    await writeJson(this.configPath, { ...config, allowedChatIds: ids });
    return this.status();
  }

  private async acquireLock(): Promise<void> {
    const existing = await readJsonObject(this.lockPath);
    const pid = readNumber(existing?.['pid']);
    const host = readString(existing?.['host']);
    if (
      pid !== undefined &&
      pid !== process.pid &&
      (host === undefined || host === hostname()) &&
      processAlive(pid)
    ) {
      throw new Error(`Telegram bot is already running (pid ${String(pid)}).`);
    }
    await writeJson(this.lockPath, {
      pid: process.pid,
      host: hostname(),
      startedAt: Date.now(),
    });
  }

  private async releaseLock(): Promise<void> {
    const existing = await readJsonObject(this.lockPath);
    if (readNumber(existing?.['pid']) === process.pid) {
      await rm(this.lockPath, { force: true });
    }
  }

  private async registerBotCommands(token: string): Promise<void> {
    await callTelegramApi(token, 'setMyCommands', {
      commands: [
        { command: 'start', description: 'Pair this chat with OmniCode' },
        { command: 'new', description: 'Create and bind a new session' },
        { command: 'sessions', description: 'List sessions' },
        { command: 'switch', description: 'Switch session: /switch <id>' },
        { command: 'status', description: 'Show OmniCode status' },
        { command: 'model', description: 'Show or set model: /model <name>' },
        { command: 'permission', description: 'Set permission mode: /permission manual|auto|yolo' },
        { command: 'stop', description: 'Stop the current turn' },
        { command: 'cancel', description: 'Cancel the current turn' },
        { command: 'compact', description: 'Compact the current session' },
        { command: 'files', description: 'List session attachments' },
        { command: 'send', description: 'Send a workspace file: /send <path>' },
        { command: 'approve', description: 'Approve a pending action' },
        { command: 'deny', description: 'Deny a pending action' },
        { command: 'help', description: 'Show commands' },
      ],
    });
    await callTelegramApi(token, 'setChatMenuButton', {
      menu_button: { type: 'commands' },
    });
  }

  private async mainAgentFor(sessionId: string) {
    const session = this.sessions.get(sessionId) ?? (await this.sessions.resume(sessionId));
    if (session === undefined) return undefined;
    const lifecycle = session.accessor.get(IAgentLifecycleService);
    const context = await ensureMainAgent(session);
    return lifecycle.handleOf(context.agentId);
  }

  private enqueuePrompt(
    token: string,
    chatId: number,
    sessionId: string,
    text: string,
    attachments: readonly ContentPart[],
    replyToMessageId?: number,
  ): void {
    const alreadyRunning = this.chatQueues.has(chatId);
    const previous = this.chatQueues.get(chatId) ?? Promise.resolve();
    const next = previous
      .then(() =>
        this.routePrompt(
          token,
          chatId,
          text,
          sessionId,
          attachments,
          replyToMessageId,
        ),
      )
      .catch(async (error: unknown) => {
        await sendMessage(token, chatId, `Turn error: ${errorMessage(error)}`).catch(() => undefined);
      });
    const tracked = next.finally(() => {
      if (this.chatQueues.get(chatId) === tracked) this.chatQueues.delete(chatId);
    });
    this.chatQueues.set(chatId, tracked);
    if (alreadyRunning) {
      void sendMessage(token, chatId, 'Queued for the next turn.').catch(() => undefined);
    }
  }

  private async materializeTelegramMedia(
    media: ISessionMediaStore,
    token: string,
    file: TelegramFile,
    name: string,
    mimeType: string,
  ): Promise<{ readonly fileId: string; readonly name: string }> {
    const { response, size } = await downloadTelegramFile(token, file);
    const fileId = `f_tg_${randomUUID().replaceAll('-', '')}`;
    const path = await media.materialize({
      fileId,
      size,
      name,
      mimeType,
      stream: () => Readable.fromWeb(response.body as never),
    });
    if (path === undefined) throw new Error('Media store rejected the file.');
    return { fileId, name };
  }

  private bufferMediaGroup(token: string, message: NonNullable<TelegramUpdate['message']>): void {
    const groupId = message.media_group_id;
    if (groupId === undefined) return;
    const existing = this.mediaGroups.get(groupId);
    if (existing !== undefined) {
      existing.messages.push(message);
      return;
    }
    const group = {
      token,
      chatId: message.chat.id,
      messages: [message],
      timer: setTimeout(() => {
        this.mediaGroups.delete(groupId);
        void this.flushMediaGroup(group).catch(() => undefined);
      }, 500),
    };
    this.mediaGroups.set(groupId, group);
  }

  private async flushMediaGroup(group: {
    readonly token: string;
    readonly chatId: number;
    readonly messages: NonNullable<TelegramUpdate['message']>[];
  }): Promise<void> {
    try {
      if (!(await this.isAllowed(group.chatId))) return;
      const binding = await this.bindingFor(group.chatId);
      if (binding === undefined) {
        await this.sendSessionPicker(
          group.token,
          group.chatId,
          'Pick a session to continue, or start a new one:',
          'No sessions yet. Send /new to start one, then resend the files.',
        );
        return;
      }
      const attachments: ContentPart[] = [];
      for (const message of group.messages) {
        attachments.push(...(await this.collectAttachments(group.token, group.chatId, message, binding.sessionId)));
      }
      const text =
        group.messages
          .map((message) => (message.caption ?? message.text ?? '').trim())
          .find((value) => value.length > 0) ?? 'Please analyze the attached content.';
      this.enqueuePrompt(
        group.token,
        group.chatId,
        binding.sessionId,
        text,
        attachments,
        group.messages[0]?.message_id,
      );
    } catch (error) {
      await sendMessage(group.token, group.chatId, `Session error: ${errorMessage(error)}`);
    }
  }

  private async collectAttachments(
    token: string,
    chatId: number,
    message: NonNullable<TelegramUpdate['message']>,
    sessionId: string,
  ): Promise<ContentPart[]> {
    const mediaKinds = [
      message.photo !== undefined,
      message.document !== undefined,
      message.video !== undefined,
      message.video_note !== undefined,
      message.audio !== undefined,
      message.voice !== undefined,
      message.animation !== undefined,
      message.sticker !== undefined,
    ];
    if (!mediaKinds.some(Boolean)) return [];
    const session = this.sessions.get(sessionId) ?? (await this.sessions.resume(sessionId));
    if (session === undefined) return [];
    const media = session.accessor.get(ISessionMediaStore);
    const parts: ContentPart[] = [];

    const addMedia = async (
      file: TelegramFile,
      name: string,
      mimeType: string,
      kind: 'image' | 'video' | 'audio',
      label: string,
    ): Promise<void> => {
      try {
        const { fileId } = await this.materializeTelegramMedia(media, token, file, name, mimeType);
        const url = buildDaemonFileUrl(fileId);
        if (kind === 'image') {
          parts.push({ type: 'image_url', imageUrl: { url, id: fileId, name } });
        } else if (kind === 'video') {
          parts.push({ type: 'video_url', videoUrl: { url, id: fileId, name } });
        } else {
          parts.push({ type: 'audio_url', audioUrl: { url, id: fileId } });
        }
      } catch (error) {
        retrySink?.({ method: label, chatId, error: errorMessage(error) });
        parts.push({ type: 'text', text: `[${label} download failed: ${errorMessage(error)}]` });
      }
    };

    if (message.photo !== undefined && message.photo.length > 0) {
      await addMedia(
        message.photo[message.photo.length - 1]!,
        'telegram-photo.jpg',
        'image/jpeg',
        'image',
        'Telegram photo',
      );
    }

    if (message.document !== undefined) {
      const document = message.document;
      const mimeType = document.mime_type ?? 'application/octet-stream';
      const name = safeFileName(document.file_name ?? defaultTelegramName(mimeType));
      if (mimeType.startsWith('image/')) {
        await addMedia(document, name, mimeType, 'image', 'Telegram image');
      } else if (mimeType.startsWith('video/')) {
        await addMedia(document, name, mimeType, 'video', 'Telegram video');
      } else if (mimeType.startsWith('audio/')) {
        await addMedia(document, name, mimeType, 'audio', 'Telegram audio');
      } else {
        try {
          const { response } = await downloadTelegramFile(token, document);
          const data = Buffer.from(await response.arrayBuffer());
          const dir = join(session.accessor.get(ISessionContext).sessionDir, 'attachments');
          await mkdir(dir, { recursive: true });
          const path = join(dir, name);
          await writeFile(path, data);
          parts.push({ type: 'text', text: `[Attached file: ${path}]` });
        } catch (error) {
          parts.push({
            type: 'text',
            text: `[Telegram file download failed: ${errorMessage(error)}]`,
          });
        }
      }
    }

    if (message.video !== undefined) {
      await addMedia(
        message.video,
        safeFileName(message.video.file_name ?? 'telegram-video.mp4'),
        message.video.mime_type ?? 'video/mp4',
        'video',
        'Telegram video',
      );
    }
    if (message.video_note !== undefined) {
      await addMedia(
        message.video_note,
        'telegram-video-note.mp4',
        'video/mp4',
        'video',
        'Telegram video note',
      );
    }
    if (message.audio !== undefined) {
      await addMedia(
        message.audio,
        safeFileName(message.audio.file_name ?? 'telegram-audio.mp3'),
        message.audio.mime_type ?? 'audio/mpeg',
        'audio',
        'Telegram audio',
      );
    }
    if (message.voice !== undefined) {
      await addMedia(
        message.voice,
        'telegram-voice.ogg',
        message.voice.mime_type ?? 'audio/ogg',
        'audio',
        'Telegram voice',
      );
    }
    if (message.animation !== undefined) {
      await addMedia(
        message.animation,
        safeFileName(message.animation.file_name ?? 'telegram-animation.mp4'),
        message.animation.mime_type ?? 'video/mp4',
        'video',
        'Telegram animation',
      );
    }
    if (message.sticker !== undefined) {
      const sticker = message.sticker;
      if (sticker.is_animated === true) {
        parts.push({
          type: 'text',
          text: `[Animated sticker${sticker.emoji === undefined ? '' : `: ${sticker.emoji}`}]`,
        });
      } else if (sticker.is_video === true) {
        await addMedia(sticker, 'telegram-sticker.webm', 'video/webm', 'video', 'Telegram sticker');
      } else {
        await addMedia(
          sticker,
          'telegram-sticker.webp',
          sticker.mime_type ?? 'image/webp',
          'image',
          'Telegram sticker',
        );
      }
    }

    return parts;
  }

  private async recentTranscript(sessionId: string, limit = 5): Promise<string> {
    const agent = await this.mainAgentFor(sessionId);
    if (agent === undefined) return 'No recent messages.';
    const memory = agent.accessor.get(IAgentContextMemoryService);
    if (memory === undefined) return 'No recent messages.';
    const history = memory.get();
    const lines: string[] = [];
    for (let index = history.length - 1; index >= 0 && lines.length < limit; index -= 1) {
      const message = history[index];
      if (message === undefined) continue;
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const text = message.content
        .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
      if (text.length === 0) continue;
      const label = message.role === 'user' ? 'You' : 'OmniCode';
      lines.push(`${label}: ${text.slice(0, 800)}`);
    }
    return lines.length === 0 ? 'No recent messages.' : lines.reverse().join('\n\n');
  }

  private async announceSessionSwitch(
    token: string,
    chatId: number,
    sessionId: string,
    messageId?: number,
  ): Promise<void> {
    let title = sessionId;
    try {
      const handle = this.sessions.get(sessionId);
      const meta = await handle?.accessor.get(ISessionMetadata).read();
      if (meta?.title !== undefined && meta.title.trim().length > 0) title = meta.title;
    } catch {
      /* title is optional */
    }
    if (messageId !== undefined) {
      await deleteMessage(token, chatId, messageId).catch(async () => {
        await editMessageText(
          token,
          chatId,
          messageId,
          `Switched to ${title}`,
          { clearKeyboard: true },
        ).catch(() => undefined);
      });
    }
    const transcript = await this.recentTranscript(sessionId);
    await sendLongMessage(
      token,
      chatId,
      `Session: ${title}\n\nLast ${String(5)} messages:\n\n${transcript}`,
    );
  }

  private async syncPendingInteractions(): Promise<void> {
    const pending = interactions.findAll({ resolved: false });
    if (pending.length === 0) return;
    const config = await this.readSecureConfig();
    const token = await this.tokenFor(config);
    if (token === '') return;
    const bindings = readBindings(config?.['bindings']);
    for (const [chatIdRaw, binding] of Object.entries(bindings)) {
      const chatId = Number(chatIdRaw);
      if (!Number.isInteger(chatId)) continue;
      for (const interaction of pending) {
        if (interaction.tags[INTERACTION_TAG_SESSION_ID] !== binding.sessionId) continue;
        const key = `${String(chatId)}:${interaction.id}`;
        if (this.handledInteractions.has(key)) continue;
        this.handledInteractions.add(key);
        await this.handleInteractionRequest(
          token,
          chatId,
          interaction.id,
          interaction.kind,
          interaction.payload,
        );
      }
    }
  }

  private async handleInteractionRequest(
    token: string,
    chatId: number,
    id: string,
    kind: string | undefined,
    request: unknown,
  ): Promise<void> {
    try {
      const payload = asRecord(request);
      if (kind === 'approval') {
        const display = asRecord(payload['display']);
        if (readString(display['kind']) === 'plan_review') {
          await this.sendPlanReview(token, chatId, id, display);
          return;
        }
        const action =
          readString(payload['action']) ?? readString(payload['toolName']) ?? 'Tool call approval';
        await sendInlineKeyboard(
          token,
          chatId,
          `Approval required\n${action}`,
          [
            [
              { text: 'Approve', callback_data: `a:${id}:approved` },
              { text: 'Deny', callback_data: `a:${id}:rejected` },
            ],
          ],
        );
        return;
      }
      if (kind === 'question') {
        const questions = readTelegramQuestions(payload['questions']);
        if (questions.length === 0) {
          await sendMessage(token, chatId, 'No questions were provided.');
          return;
        }
        const flow: TelegramQuestionFlow = {
          token,
          chatId,
          questions,
          answers: {},
          selections: questions.map(() => new Set<number>()),
          current: 0,
        };
        this.questionFlows.set(id, flow);
        await this.sendQuestion(id, flow, 0);
      }
    } catch (error) {
      await sendMessage(token, chatId, `Interaction error: ${errorMessage(error)}`);
    }
  }

  private async sendPlanReview(
    token: string,
    chatId: number,
    id: string,
    display: Record<string, unknown>,
  ): Promise<void> {
    const plan = readString(display['plan']) ?? '';
    const options = Array.isArray(display['options']) ? display['options'] : [];
    const rows: { text: string; callback_data: string }[][] = [];
    for (let index = 0; index < Math.min(options.length, 6); index += 1) {
      const label = readString(asRecord(options[index])['label']);
      if (label !== undefined && label.length > 0) {
        rows.push([
          {
            text: `Approve: ${label}`.slice(0, 60),
            callback_data: `p:${id}:o:${index}`,
          },
        ]);
      }
    }
    rows.push([
      { text: 'Approve', callback_data: `p:${id}:a` },
      { text: 'Revise', callback_data: `p:${id}:r` },
      { text: 'Reject and Exit', callback_data: `p:${id}:x` },
    ]);
    const text = `Plan review\n\n${plan}`.slice(0, 3_500).trim();
    await sendInlineKeyboard(token, chatId, text.length > 0 ? text : 'Plan review', rows, {
      markdown: true,
    });
  }

  private questionKeyboard(
    id: string,
    flow: TelegramQuestionFlow,
    questionIndex: number,
  ): { text: string; callback_data: string }[][] {
    const question = flow.questions[questionIndex];
    if (question === undefined) return [];
    const selected = flow.selections[questionIndex] ?? new Set<number>();
    const rows = question.options.slice(0, 8).map((option, optionIndex) => {
      const check = question.multiSelect === true ? (selected.has(optionIndex) ? '☑ ' : '☐ ') : '';
      return [
        {
          text: `${check}${option.label}`.slice(0, 60),
          callback_data:
            question.multiSelect === true
              ? `qm:${id}:${questionIndex}:${optionIndex}`
              : `q:${id}:${questionIndex}:${optionIndex}`,
        },
      ];
    });
    if (question.multiSelect === true) {
      rows.push([{ text: 'Done', callback_data: `qm:${id}:${questionIndex}:done` }]);
    }
    rows.push([
      {
        text: question.otherLabel ?? 'Other',
        callback_data: `qo:${id}:${questionIndex}`,
      },
      { text: 'Cancel', callback_data: `qx:${id}` },
    ]);
    return rows;
  }

  private async sendQuestion(
    id: string,
    flow: TelegramQuestionFlow,
    questionIndex: number,
  ): Promise<void> {
    const question = flow.questions[questionIndex];
    if (question === undefined) {
      await this.advanceQuestion(id, flow, questionIndex);
      return;
    }
    flow.current = questionIndex;
    const lines = [`Question ${questionIndex + 1}/${flow.questions.length}`];
    if (question.header !== undefined && question.header.trim().length > 0) {
      lines.push(question.header);
    }
    lines.push('', question.question);
    for (const option of question.options) {
      if (option.description !== undefined && option.description.trim().length > 0) {
        lines.push(`• ${option.label}: ${option.description}`);
      }
    }
    flow.messageId = await sendInlineKeyboard(
      flow.token,
      flow.chatId,
      lines.join('\n'),
      this.questionKeyboard(id, flow, questionIndex),
    );
  }

  private async advanceQuestion(
    id: string,
    flow: TelegramQuestionFlow,
    next: number,
  ): Promise<void> {
    if (next < flow.questions.length) {
      await this.sendQuestion(id, flow, next);
      return;
    }
    const ok = interactions.respond(id, { answers: flow.answers });
    this.questionFlows.delete(id);
    const text = ok ? 'Answers sent.' : 'Question expired.';
    if (flow.messageId !== undefined) {
      await editMessageText(flow.token, flow.chatId, flow.messageId, text, {
        clearKeyboard: true,
      }).catch(() => undefined);
    } else {
      await sendMessage(flow.token, flow.chatId, text);
    }
  }

  private async handleQuestionCallback(
    token: string,
    chatId: number,
    id: string,
    mode: 'single' | 'multi',
    questionIndexRaw: string | undefined,
    optionIndexRaw: string | undefined,
    callback: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    const flow = this.questionFlows.get(id);
    if (flow === undefined) {
      await answerCallbackQuery(token, callback.id, 'Expired');
      return;
    }
    const questionIndex = Number(questionIndexRaw ?? '0');
    const question = flow.questions[questionIndex];
    if (question === undefined) {
      await answerCallbackQuery(token, callback.id, 'Expired');
      return;
    }

    if (mode === 'single') {
      const optionIndex = Number(optionIndexRaw ?? '0');
      const label = question.options[optionIndex]?.label ?? 'Answer';
      flow.answers[question.question] = label;
      await answerCallbackQuery(token, callback.id, label);
      if (callback.message !== undefined) {
        await editMessageText(
          token,
          chatId,
          callback.message.message_id,
          `✅ ${label}`,
          { clearKeyboard: true },
        ).catch(() => undefined);
      }
      await this.advanceQuestion(id, flow, questionIndex + 1);
      return;
    }

    const selected = flow.selections[questionIndex] ?? new Set<number>();
    flow.selections[questionIndex] = selected;
    if (optionIndexRaw === 'done') {
      if (selected.size === 0) {
        await answerCallbackQuery(token, callback.id, 'Select at least one');
        return;
      }
      const labels = question.options
        .filter((_option, index) => selected.has(index))
        .map((option) => option.label);
      const answer = labels.join(', ');
      flow.answers[question.question] = answer;
      await answerCallbackQuery(token, callback.id, 'Done');
      if (callback.message !== undefined) {
        await editMessageText(
          token,
          chatId,
          callback.message.message_id,
          `✅ ${answer}`,
          { clearKeyboard: true },
        ).catch(() => undefined);
      }
      await this.advanceQuestion(id, flow, questionIndex + 1);
      return;
    }

    const optionIndex = Number(optionIndexRaw ?? '0');
    if (question.options[optionIndex] === undefined) {
      await answerCallbackQuery(token, callback.id, 'Expired');
      return;
    }
    if (selected.has(optionIndex)) selected.delete(optionIndex);
    else selected.add(optionIndex);
    await answerCallbackQuery(
      token,
      callback.id,
      selected.has(optionIndex) ? 'Selected' : 'Removed',
    );
    if (callback.message !== undefined) {
      await editMessageReplyMarkup(
        token,
        chatId,
        callback.message.message_id,
        this.questionKeyboard(id, flow, questionIndex),
      ).catch(() => undefined);
    }
  }

  private async handlePlanCallback(
    token: string,
    chatId: number,
    id: string,
    action: string | undefined,
    optionIndexRaw: string | undefined,
    callback: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    const interaction = interactions.findOne({ id });
    if (interaction === undefined) {
      await answerCallbackQuery(token, callback.id, 'Expired');
      return;
    }
    const payload = asRecord(interaction.payload);
    const display = asRecord(payload['display']);
    const options = Array.isArray(display['options']) ? display['options'] : [];
    const messageId = callback.message?.message_id;

    if (action === 'o') {
      const label = readString(asRecord(options[Number(optionIndexRaw ?? '0')])['label']) ?? 'Approved';
      const ok = interactions.respond(id, { decision: 'approved', selectedLabel: label });
      await answerCallbackQuery(token, callback.id, ok ? `Approved: ${label}` : 'Expired');
      if (messageId !== undefined) {
        await editMessageText(token, chatId, messageId, `Approved: ${label}`, {
          clearKeyboard: true,
        }).catch(
          () => undefined,
        );
      }
      return;
    }
    if (action === 'a') {
      const ok = interactions.respond(id, { decision: 'approved' });
      await answerCallbackQuery(token, callback.id, ok ? 'Approved' : 'Expired');
      if (messageId !== undefined) {
        await editMessageText(token, chatId, messageId, 'Approved.', {
          clearKeyboard: true,
        }).catch(() => undefined);
      }
      return;
    }
    if (action === 'r') {
      this.pendingTextReplies.set(chatId, { kind: 'plan_feedback', id });
      await answerCallbackQuery(token, callback.id, 'Send feedback');
      if (messageId !== undefined) {
        await editMessageText(
          token,
          chatId,
          messageId,
          'Revision requested. Send your feedback as the next message.',
          { clearKeyboard: true },
        ).catch(() => undefined);
      }
      await sendForceReply(token, chatId, 'Send your revision feedback as the next message.');
      return;
    }
    if (action === 'x') {
      const ok = interactions.respond(id, {
        decision: 'rejected',
        selectedLabel: 'Reject and Exit',
      });
      await answerCallbackQuery(token, callback.id, ok ? 'Rejected' : 'Expired');
      if (messageId !== undefined) {
        await editMessageText(token, chatId, messageId, 'Rejected and exited plan mode.', {
          clearKeyboard: true,
        }).catch(
          () => undefined,
        );
      }
    }
  }

  private async handlePendingTextReply(
    token: string,
    chatId: number,
    pending: TelegramPendingTextReply,
    text: string,
  ): Promise<void> {
    if (pending.kind === 'plan_feedback') {
      const ok = interactions.respond(pending.id, {
        decision: 'rejected',
        feedback: text,
      });
      await sendMessage(token, chatId, ok ? 'Revision feedback sent.' : 'Plan review expired.');
      return;
    }
    const flow = this.questionFlows.get(pending.id);
    if (flow === undefined) {
      await sendMessage(token, chatId, 'Question expired.');
      return;
    }
    const questionIndex = pending.questionIndex ?? flow.current;
    const question = flow.questions[questionIndex];
    if (question === undefined) {
      await sendMessage(token, chatId, 'Question expired.');
      return;
    }
    flow.answers[question.question] = text;
    await sendMessage(token, chatId, 'Answer saved.');
    await this.advanceQuestion(pending.id, flow, questionIndex + 1);
  }

  private async handleCallbackQuery(
    token: string,
    callback: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    const data = callback.data ?? '';
    const [kind, id, action, questionIndex, optionIndex] = data.split(':');
    const chatId = callback.message?.chat.id;
    if (chatId === undefined) return;
    if (!(await this.isAllowed(chatId))) {
      await answerCallbackQuery(token, callback.id, 'This chat is not paired');
      return;
    }
    if (kind === 's' && id !== undefined) {
      const session = this.sessions.get(id);
      if (session === undefined) {
        await answerCallbackQuery(token, callback.id, 'Session not found');
        return;
      }
      const existing = await this.bindingFor(chatId);
      const context = session.accessor.get(ISessionContext);
      const binding: TelegramChatBinding = {
        sessionId: id,
        workspaceRoot: context.cwd,
        updatedAt: Date.now(),
        permission: existing?.permission ?? 'manual',
      };
      await this.bindChat(chatId, binding);
      await answerCallbackQuery(token, callback.id, `Switched to ${id.slice(0, 8)}`);
      await this.announceSessionSwitch(token, chatId, id, callback.message?.message_id);
      const pick = this.takePendingPick(chatId);
      if (pick !== undefined) {
        await this.routeBoundPrompt(token, chatId, binding, pick);
      }
      return;
    }
    if (kind === 'n' && id === 'new') {
      const binding = await this.createSessionForChat(chatId);
      await answerCallbackQuery(token, callback.id, 'New session started');
      await this.announceSessionSwitch(token, chatId, binding.sessionId, callback.message?.message_id);
      const pick = this.takePendingPick(chatId);
      if (pick !== undefined) {
        await this.routeBoundPrompt(token, chatId, binding, pick);
      }
      return;
    }
    if (kind === 'm') {
      const model = data.slice(2);
      if (model.length === 0) return;
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await answerCallbackQuery(token, callback.id, 'No session bound');
        return;
      }
      try {
        const agent = await this.mainAgentFor(binding.sessionId);
        if (agent === undefined) throw new Error('Main agent is not available.');
        const result = await agent.accessor.get(IAgentProfileService).setModel(model);
        await answerCallbackQuery(token, callback.id, `Model: ${result.model}`);
        if (callback.message !== undefined) {
          await editMessageText(
            token,
            chatId,
            callback.message.message_id,
            `Model set to ${result.model}.`,
          ).catch(() => undefined);
        }
      } catch (error) {
        await answerCallbackQuery(token, callback.id, errorMessage(error).slice(0, 60));
      }
      return;
    }
    if (kind === 'pm') {
      const mode = data.slice(3);
      const binding = await this.bindingFor(chatId);
      if (binding === undefined || !isPermissionMode(mode)) {
        await answerCallbackQuery(token, callback.id, 'Invalid mode');
        return;
      }
      await this.bindChat(chatId, { ...binding, permission: mode, updatedAt: Date.now() });
      const agent = await this.mainAgentFor(binding.sessionId);
      agent?.accessor.get(IAgentPermissionModeService).setModeAndBroadcast(mode);
      await this.audit('permission.changed', { chatId, mode });
      await answerCallbackQuery(token, callback.id, `Permission: ${mode}`);
      if (callback.message !== undefined) {
        await editMessageText(
          token,
          chatId,
          callback.message.message_id,
          `Permission mode set to ${mode}.`,
        ).catch(() => undefined);
      }
      return;
    }
    if (kind === 'p' && id !== undefined) {
      await this.handlePlanCallback(token, chatId, id, action, questionIndex, callback);
      return;
    }
    if (kind === 'qm' && id !== undefined) {
      await this.handleQuestionCallback(
        token,
        chatId,
        id,
        'multi',
        action,
        questionIndex,
        callback,
      );
      return;
    }
    if (kind === 'q' && id !== undefined) {
      await this.handleQuestionCallback(
        token,
        chatId,
        id,
        'single',
        action,
        questionIndex,
        callback,
      );
      return;
    }
    if (kind === 'qo' && id !== undefined) {
      const flow = this.questionFlows.get(id);
      const question = flow?.questions[Number(action ?? '0')];
      if (flow === undefined || question === undefined) {
        await answerCallbackQuery(token, callback.id, 'Expired');
        return;
      }
      this.pendingTextReplies.set(chatId, {
        kind: 'question_other',
        id,
        questionIndex: Number(action ?? '0'),
      });
      await answerCallbackQuery(token, callback.id, 'Send your answer');
      if (callback.message !== undefined) {
        await editMessageText(
          token,
          chatId,
          callback.message.message_id,
          `${question.question}\n\nType your answer as the next message.`,
          { clearKeyboard: true },
        ).catch(() => undefined);
      }
      await sendForceReply(
        token,
        chatId,
        `${question.question}\n\nType your answer as the next message.`,
      );
      return;
    }
    if (kind === 'qx' && id !== undefined) {
      const ok = interactions.respond(id, null);
      this.questionFlows.delete(id);
      await answerCallbackQuery(token, callback.id, ok ? 'Dismissed' : 'Expired');
      if (callback.message !== undefined) {
        await editMessageText(token, chatId, callback.message.message_id, 'Question dismissed.', {
          clearKeyboard: true,
        }).catch(
          () => undefined,
        );
      }
      return;
    }
    if (kind === 'a' && id !== undefined) {
      const approved = action === 'approved';
      const ok = interactions.respond(id, { decision: approved ? 'approved' : 'rejected' });
      await answerCallbackQuery(token, callback.id, ok ? (approved ? 'Approved' : 'Denied') : 'Expired');
      if (callback.message !== undefined) {
        await editMessageText(
          token,
          chatId,
          callback.message.message_id,
          approved ? 'Approved.' : 'Denied.',
          { clearKeyboard: true },
        ).catch(() => undefined);
      }
      return;
    }

  }

  private async routePrompt(
    token: string,
    chatId: number,
    text: string,
    sessionId: string,
    attachments: readonly ContentPart[] = [],
    replyToMessageId?: number,
  ): Promise<void> {
    const agent = await this.mainAgentFor(sessionId);
    if (agent === undefined) {
      await sendMessage(token, chatId, 'Main agent is not available for this session.');
      return;
    }
    // The permission mode is global agent state set via /permission and the
    // CLI; re-applying the binding's record here would fight other surfaces.
    const loop = agent.accessor.get(IAgentLoopService);
    const events = agent.accessor.get(IEventBus);
    let reply = '';
    void sendChatAction(token, chatId).catch(() => undefined);
    if (replyToMessageId !== undefined) {
      void setMessageReaction(token, chatId, replyToMessageId, '👀').catch(() => undefined);
    }
    const typingTimer = setInterval(() => {
      void sendChatAction(token, chatId).catch(() => undefined);
    }, 4_000);
    const progressId = await sendMessage(token, chatId, 'OmniCode is working…', {
      replyToMessageId,
    });
    const showMcpCalls = ((await this.readSecureConfig())?.['showMcpCalls'] ?? true) !== false;
    let lastProgress = '';
    const progressTimer =
      progressId === undefined
        ? undefined
        : setInterval(() => {
            if (reply.length === 0 || reply === lastProgress) return;
            lastProgress = reply;
            void editMessageText(token, chatId, progressId, reply.slice(0, 4000)).catch(
              () => undefined,
            );
          }, 1_200);
    const subscription = events.subscribe((event) => {
      if (
        event.type === 'assistant.delta' &&
        (event as unknown as { readonly agentId?: unknown }).agentId === agent.id &&
        typeof (event as unknown as { readonly delta?: unknown }).delta === 'string'
      ) {
        reply += (event as unknown as { readonly delta: string }).delta;
        return;
      }
      if (event.type === 'tool.call.started' && showMcpCalls) {
        const call = event as unknown as {
          readonly agentId?: unknown;
          readonly name?: unknown;
          readonly args?: unknown;
        };
        if (call.agentId !== agent.id || typeof call.name !== 'string') return;
        const notice = formatMcpCallNotice(call.name, call.args);
        if (notice !== undefined) void sendMessage(token, chatId, notice).catch(() => undefined);
        return;
      }
      if (event.type === 'interaction.request') {
        const request = event as unknown as {
          readonly agentId?: string;
          readonly id?: string;
          readonly kind?: string;
          readonly request?: unknown;
        };
        if (request.agentId === agent.id && typeof request.id === 'string') {
          const key = `${String(chatId)}:${request.id}`;
          if (this.handledInteractions.has(key)) return;
          this.handledInteractions.add(key);
          void this.handleInteractionRequest(token, chatId, request.id, request.kind, request.request);
        }
      }
      if (event.type === 'memory.saved') {
        const saved = event as unknown as {
          readonly agentId?: string;
          readonly content?: string;
          readonly category?: string;
          readonly trust?: string;
        };
        const content = (saved.content ?? '').trim();
        if (saved.agentId === agent.id && content.length > 0) {
          void sendMessage(
            token,
            chatId,
            `🧠 Memory saved (${saved.category ?? 'fact'}, ${saved.trust ?? 'trusted'})\n${content.slice(0, 500)}`,
          ).catch(() => undefined);
        }
      }
    });
    try {
      const promptId = randomUUID();
      const { id } = loop.submit({
        message: { role: 'user', content: [{ type: 'text', text }, ...attachments] },
        meta: {
          promptId,
          origin: {
            kind: 'user',
            clientMetadata: [{ source: 'telegram' }],
          } as UserPromptOrigin,
          tracked: true,
        },
      });
      const handle = loop.promptHandle(id);
      if (handle === undefined) throw new Error('Prompt did not start.');
      const completion = await Promise.race([
        handle.completion,
        delay(10 * 60 * 1000).then(() => undefined),
      ]);
      if (completion === undefined) {
        loop.cancel({ promptId: id }, new Error('Telegram prompt timed out'));
        if (progressTimer !== undefined) clearInterval(progressTimer);
        await finishProgress(token, chatId, progressId, 'Prompt timed out.');
        return;
      }
      if (completion.state !== 'completed') {
        if (progressTimer !== undefined) clearInterval(progressTimer);
        await finishProgress(token, chatId, progressId, `Turn ${completion.state}.`);
        return;
      }
      if (progressTimer !== undefined) clearInterval(progressTimer);
      if (replyToMessageId !== undefined) {
        void setMessageReaction(token, chatId, replyToMessageId, '👍').catch(() => undefined);
      }
      await finishProgress(token, chatId, progressId, reply.trim() || 'No reply.');
    } finally {
      clearInterval(typingTimer);
      if (progressTimer !== undefined) clearInterval(progressTimer);
      subscription.dispose();
    }
  }

  private async supervise(token: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.runLoop(token, signal);
      } catch (error) {
        if (signal.aborted) break;
        await writeTelegramState(this.statePath, {
          running: true,
          pid: process.pid,
          heartbeatAt: Date.now(),
          lastError: errorMessage(error),
        });
        await delay(5_000, undefined, { signal }).catch(() => undefined);
      }
    }
  }

  private async runLoop(token: string, signal: AbortSignal): Promise<void> {
    let lastUpdateId = (await readJsonObject(this.statePath))?.['lastUpdateId'];
    let offset = typeof lastUpdateId === 'number' ? lastUpdateId + 1 : 0;
    while (!signal.aborted) {
      await writeTelegramState(this.statePath, {
        running: true,
        pid: process.pid,
        heartbeatAt: Date.now(),
        lastUpdateId: typeof lastUpdateId === 'number' ? lastUpdateId : undefined,
      });
      try {
        const updates = await getUpdates(token, offset, signal);
        for (const update of updates) {
          lastUpdateId = update.update_id;
          offset = update.update_id + 1;
          if (this.seenUpdateIds.has(update.update_id)) continue;
          this.rememberUpdate(update.update_id);
          await this.bumpMetric('updates');
          if (update.message !== undefined || update.callback_query !== undefined) {
            await this.bumpMetric('messages');
          }
          try {
            await this.handleUpdate(token, update);
          } catch (error) {
            await this.bumpMetric('errors');
            await writeTelegramState(this.statePath, {
              running: true,
              pid: process.pid,
              heartbeatAt: Date.now(),
              lastUpdateId,
              lastError: errorMessage(error),
            });
          }
          await writeTelegramState(this.statePath, {
            running: true,
            pid: process.pid,
            heartbeatAt: Date.now(),
            lastUpdateId,
            lastUpdateAt: Date.now(),
            lastError: undefined,
          });
        }
      } catch (error) {
        if (signal.aborted) break;
        await writeTelegramState(this.statePath, {
          running: true,
          pid: process.pid,
          heartbeatAt: Date.now(),
          lastUpdateId: typeof lastUpdateId === 'number' ? lastUpdateId : undefined,
          lastError: errorMessage(error),
        });
        await delay(5_000, undefined, { signal }).catch(() => undefined);
      }
    }
    await writeTelegramState(this.statePath, {
      running: false,
      heartbeatAt: Date.now(),
      lastUpdateId: typeof lastUpdateId === 'number' ? lastUpdateId : undefined,
    });
  }

  private async handleUpdate(token: string, update: TelegramUpdate): Promise<void> {
    if (update.callback_query !== undefined) {
      await this.handleCallbackQuery(token, update.callback_query);
      return;
    }
    const message = update.message;
    if (message === undefined) return;
    const pending = this.pendingTextReplies.get(message.chat.id);
    if (pending !== undefined && message.text !== undefined) {
      this.pendingTextReplies.delete(message.chat.id);
      await this.handlePendingTextReply(token, message.chat.id, pending, message.text.trim());
      return;
    }
    if (message.media_group_id !== undefined) {
      if (!(await this.isAllowed(message.chat.id))) {
        await sendMessage(
          token,
          message.chat.id,
          'This chat is not paired. Use the code from /connectors.',
        );
        return;
      }
      this.bufferMediaGroup(token, message);
      return;
    }
    const chatId = message.chat.id;
    const text = (message.text ?? message.caption ?? '').trim();
    if (text.length > 8_000) {
      await sendMessage(token, chatId, 'Message is too long. Limit is 8,000 characters.');
      return;
    }
    if (text.startsWith('/')) await this.audit('command', { chatId, command: text.split(/\s+/)[0] });
    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1] ?? '';
      if (code !== '' && (await this.pairChat(code, chatId))) {
        await sendMessage(
          token,
          chatId,
          'Connected. Send a message and OmniCode will ask which session to continue, or /new to start one.',
        );
      } else {
        await sendMessage(
          token,
          chatId,
          'Pair this chat from OmniCode: open /connectors, choose Telegram, then Pair chat.',
        );
      }
      return;
    }
    if (text === '/help') {
      await sendMessage(token, chatId, 'OmniCode Telegram: /start <code>, /new, /bind [id], /sessions, /switch <id>, /detach, /status, /model, /permission, /stop, /compact, /files, /send <path>, /help');
      return;
    }
    if (!(await this.isAllowed(chatId))) {
      await sendMessage(token, chatId, 'This chat is not paired. Use the code from /connectors.');
      return;
    }
    if (text === '/new') {
      try {
        const binding = await this.createSessionForChat(chatId);
        await sendMessage(
          token,
          chatId,
          `New session: ${binding.sessionId}\nSend a message to start.`,
        );
      } catch (error) {
        await sendMessage(token, chatId, `Could not create a session: ${errorMessage(error)}`);
      }
      return;
    }
    if (text === '/bind' || text.startsWith('/bind ')) {
      const requested = text.slice('/bind'.length).trim();
      const sessionId =
        requested.length > 0
          ? requested
          : (await this.latestSession())?.accessor.get(ISessionContext).sessionId;
      if (sessionId === undefined) {
        await sendMessage(token, chatId, 'No sessions available. Use /new to create one.');
        return;
      }
      const handle = this.sessions.get(sessionId);
      if (handle === undefined) {
        await sendMessage(token, chatId, `Session not found: ${sessionId}`);
        return;
      }
      const existing = await this.bindingFor(chatId);
      const context = handle.accessor.get(ISessionContext);
      await this.bindChat(chatId, {
        sessionId,
        workspaceRoot: context.cwd,
        updatedAt: Date.now(),
        permission: existing?.permission ?? 'manual',
      });
      await this.announceSessionSwitch(token, chatId, sessionId);
      return;
    }
    if (text === '/detach') {
      await this.unbindChat(chatId);
      await sendMessage(token, chatId, 'Detached from the current session. Use /bind to attach again.');
      return;
    }
    if (text === '/sessions') {
      const current = await this.bindingFor(chatId);
      await this.sendSessionPicker(
        token,
        chatId,
        current === undefined ? 'Choose a session' : `Current: ${current.sessionId}`,
        'No sessions. Use /new to create one.',
      );
      return;
    }
    if (text.startsWith('/switch')) {
      const sessionId = text.split(/\s+/)[1] ?? '';
      if (sessionId === '') {
        await sendMessage(token, chatId, 'Usage: /switch <sessionId>');
        return;
      }
      if (this.sessions.get(sessionId) === undefined) {
        await sendMessage(token, chatId, `Session not found: ${sessionId}`);
        return;
      }
      const existing = await this.bindingFor(chatId);
      await this.bindChat(chatId, {
        sessionId,
        workspaceRoot: existing?.workspaceRoot ?? process.cwd(),
        updatedAt: Date.now(),
        permission: existing?.permission ?? 'manual',
      });
      await this.announceSessionSwitch(token, chatId, sessionId);
      return;
    }
    if (text === '/status') {
      const status = await this.status();
      const binding = await this.bindingFor(chatId);
      const liveAgent = binding === undefined ? undefined : await this.mainAgentFor(binding.sessionId);
      const permission = binding === undefined
        ? 'manual'
        : liveAgent?.accessor.get(IAgentPermissionModeService).mode ?? binding.permission ?? 'manual';
      await sendMessage(
        token,
        chatId,
        [
          `OmniCode: ${status.state}`,
          `Allowed chats: ${status.allowedChatIds.length}`,
          `Bound chats: ${status.boundChats ?? 0}`,
          binding === undefined ? 'Session: none' : `Session: ${binding.sessionId}`,
          `Permission: ${permission}`,
          `Uptime: ${status.uptimeMs === undefined ? 'n/a' : formatDuration(status.uptimeMs)}`,
          `Updates: ${status.metrics?.updates ?? 0} | Messages: ${status.metrics?.messages ?? 0} | Errors: ${status.metrics?.errors ?? 0}`,
        ].join('\n'),
      );
      return;
    }
    if (text === '/stop' || text === '/cancel') {
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await sendMessage(token, chatId, 'No session is bound.');
        return;
      }
      try {
        const agent = await this.mainAgentFor(binding.sessionId);
        agent?.accessor.get(IAgentLoopService).cancel();
        await sendMessage(token, chatId, 'Stopped the current turn.');
      } catch (error) {
        await sendMessage(token, chatId, `Could not stop: ${errorMessage(error)}`);
      }
      return;
    }
    if (text.startsWith('/model')) {
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await sendMessage(token, chatId, 'No session is bound.');
        return;
      }
      try {
        const agent = await this.mainAgentFor(binding.sessionId);
        if (agent === undefined) {
          await sendMessage(token, chatId, 'Main agent is not available.');
          return;
        }
        const profile = agent.accessor.get(IAgentProfileService);
        const next = text.split(/\s+/)[1];
        if (next === undefined) {
          const current = profile.getModel();
          const models = await agent.accessor.get(IModelCatalog).listModels();
          const rows = models.slice(0, 8).map((model) => [
            {
              text: `${model.model === current ? '✓ ' : ''}${model.model}`.slice(0, 60),
              callback_data: `m:${model.model}`,
            },
          ]);
          if (rows.length === 0) {
            await sendMessage(token, chatId, `Model: ${current}`);
            return;
          }
          await sendInlineKeyboard(token, chatId, `Current model: ${current}`, rows);
          return;
        }
        const result = await profile.setModel(next);
        await sendMessage(token, chatId, `Model set to ${result.model}.`);
      } catch (error) {
        await sendMessage(token, chatId, `Model error: ${errorMessage(error)}`);
      }
      return;
    }
    if (text === '/compact') {
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await sendMessage(token, chatId, 'No session is bound.');
        return;
      }
      try {
        const agent = await this.mainAgentFor(binding.sessionId);
        if (agent === undefined) {
          await sendMessage(token, chatId, 'Main agent is not available.');
          return;
        }
        const started = agent.accessor.get(IAgentFullCompactionService).begin({ source: 'manual' });
        await sendMessage(token, chatId, started ? 'Compaction started.' : 'Compaction is already running.');
      } catch (error) {
        await sendMessage(token, chatId, `Compaction error: ${errorMessage(error)}`);
      }
      return;
    }
    if (text === '/approve' || text === '/deny') {
      await sendMessage(token, chatId, 'Approvals arrive in the next phase.');
      return;
    }
    if (text.startsWith('/permission')) {
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await sendMessage(token, chatId, 'No session is bound.');
        return;
      }
      const next = text.split(/\s+/)[1];
      if (next === undefined) {
        const liveAgent = await this.mainAgentFor(binding.sessionId);
        const current =
          liveAgent?.accessor.get(IAgentPermissionModeService).mode ?? binding.permission ?? 'manual';
        await sendInlineKeyboard(
          token,
          chatId,
          `Permission mode: ${current}`,
          [
            [
              { text: `${current === 'manual' ? '✓ ' : ''}Manual`, callback_data: 'pm:manual' },
              { text: `${current === 'auto' ? '✓ ' : ''}Auto`, callback_data: 'pm:auto' },
              { text: `${current === 'yolo' ? '✓ ' : ''}Yolo`, callback_data: 'pm:yolo' },
            ],
          ],
        );
        return;
      }
      if (!isPermissionMode(next)) {
        await sendMessage(token, chatId, 'Usage: /permission manual|auto|yolo');
        return;
      }
      await this.bindChat(chatId, {
        ...binding,
        permission: next,
        updatedAt: Date.now(),
      });
      const agent = await this.mainAgentFor(binding.sessionId);
      agent?.accessor.get(IAgentPermissionModeService).setModeAndBroadcast(next);
      await this.audit('permission.changed', { chatId, mode: next });
      await sendMessage(token, chatId, `Permission mode set to ${next}.`);
      return;
    }
    if (text === '/files') {
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await sendMessage(token, chatId, 'No session is bound.');
        return;
      }
      try {
        const session = this.sessions.get(binding.sessionId) ?? (await this.sessions.resume(binding.sessionId));
        if (session === undefined) {
          await sendMessage(token, chatId, 'Session not found.');
          return;
        }
        const dir = join(session.accessor.get(ISessionContext).sessionDir, 'attachments');
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        await sendMessage(
          token,
          chatId,
          files.length === 0 ? 'No session attachments.' : `Attachments:\n${files.join('\n')}`,
        );
      } catch (error) {
        await sendMessage(token, chatId, `Could not list files: ${errorMessage(error)}`);
      }
      return;
    }
    if (text.startsWith('/send')) {
      const binding = await this.bindingFor(chatId);
      if (binding === undefined) {
        await sendMessage(token, chatId, 'No session is bound.');
        return;
      }
      const requested = text.slice('/send'.length).trim();
      if (requested === '') {
        await sendMessage(token, chatId, 'Usage: /send <path>');
        return;
      }
      try {
        const root = resolve(binding.workspaceRoot);
        const candidate = resolve(root, requested);
        const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
        if (candidate !== root && !candidate.startsWith(prefix)) {
          await sendMessage(token, chatId, 'Path must stay inside the workspace.');
          return;
        }
        const info = await stat(candidate);
        if (!info.isFile()) {
          await sendMessage(token, chatId, 'Not a file.');
          return;
        }
        if (info.size > 50 * 1024 * 1024) {
          await sendMessage(token, chatId, 'File is larger than the 50 MB Telegram limit.');
          return;
        }
        await sendDocument(token, chatId, candidate);
        await sendMessage(token, chatId, `Sent ${candidate.slice(root.length + 1)}.`);
      } catch (error) {
        await sendMessage(token, chatId, `Could not send file: ${errorMessage(error)}`);
      }
      return;
    }
    const binding = await this.bindingFor(chatId);
    if (binding === undefined) {
      this.pendingSessionPicks.set(chatId, { message, at: Date.now() });
      await this.sendSessionPicker(
        token,
        chatId,
        'Pick a session to continue, or start a new one:',
        'No sessions yet. Send /new to start one.',
      );
      return;
    }
    await this.routeBoundPrompt(token, chatId, binding, message);
  }

  private async pairChat(code: string, chatId: number): Promise<boolean> {
    const failure = this.pairingFailures.get(chatId);
    if (failure !== undefined && failure.blockedUntil > Date.now()) return false;
    const config = (await readJsonObject(this.configPath)) ?? {};
    const pairing = readPairing(config['pairing']);
    const valid =
      pairing !== undefined &&
      pairing.code === code.trim().toUpperCase() &&
      pairing.expiresAt >= Date.now();
    if (!valid) {
      const next = {
        count: (failure?.count ?? 0) + 1,
        blockedUntil: 0,
      };
      if (next.count >= 5) next.blockedUntil = Date.now() + 10 * 60 * 1000;
      this.pairingFailures.set(chatId, next);
      await this.audit('pairing.failed', { chatId, attempts: next.count });
      return false;
    }
    const ids = readChatIds(config['allowedChatIds']);
    if (!ids.includes(chatId)) ids.push(chatId);
    const next: Record<string, unknown> = { ...config, allowedChatIds: ids };
    delete next['pairing'];
    await writeJson(this.configPath, next);
    this.pairingFailures.delete(chatId);
    await this.audit('pairing.success', { chatId });
    return true;
  }

  private async isAllowed(chatId: number): Promise<boolean> {
    const config = await readJsonObject(this.configPath);
    return readChatIds(config?.['allowedChatIds']).includes(chatId);
  }

  private async bumpMetric(metric: keyof TelegramMetrics): Promise<void> {
    this.metricWrites = this.metricWrites.then(async () => {
      const state = (await readJsonObject(this.statePath)) ?? {};
      const metrics = readMetrics(state['metrics']);
      await writeTelegramState(this.statePath, {
        metrics: { ...metrics, [metric]: metrics[metric] + 1 },
      });
    });
    await this.metricWrites;
  }

  private async audit(event: string, data: Record<string, unknown>): Promise<void> {
    try {
      const path = join(this.bootstrap.homeDir, 'telegram-audit.jsonl');
      await appendFile(
        path,
        `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`,
        { mode: 0o600 },
      );
    } catch {
      /* audit is best-effort */
    }
  }

  private async readLifecycle(): Promise<TelegramLifecycle> {
    const state = await readJsonObject(this.statePath);
    if (state?.['running'] === false) return { running: false };
    const pid = state?.['pid'];
    const heartbeatAt = state?.['heartbeatAt'];
    if (typeof pid !== 'number' || typeof heartbeatAt !== 'number') return { running: false };
    const fresh = Date.now() - heartbeatAt < HEARTBEAT_STALE_MS;
    return {
      running: fresh && processAlive(pid),
      pid,
      heartbeatAt,
    };
  }
}

function connectorState(hasToken: boolean, allowedChatIds: readonly number[]): TelegramConnectorState {
  if (!hasToken) return 'not-configured';
  if (allowedChatIds.length === 0) return 'awaiting-chat';
  return 'ready';
}

function readChatIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const entry of value) {
    const id = typeof entry === 'number' ? entry : Number.parseInt(String(entry), 10);
    if (Number.isFinite(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function telegramApiBase(): string {
  const override = process.env['TELEGRAM_API_BASE_URL'];
  return typeof override === 'string' && override.trim() !== ''
    ? override.trim().replace(/\/+$/, '')
    : 'https://api.telegram.org';
}

async function probeBot(
  token: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<TelegramProbe> {
  let lastError: string | undefined;
  // One retry covers the transient network stall that surfaces as
  // "The operation was aborted due to timeout" in the connector card.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${telegramApiBase()}/bot${token}/getMe`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    return await readProbeResponse(response);
  }
  return { error: redactTelegramSecrets(lastError ?? 'probe failed') };
}

async function readProbeResponse(response: Response): Promise<TelegramProbe> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { error: `HTTP ${response.status}` };
  }
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const result = record['result'];
  if (record['ok'] !== true || typeof result !== 'object' || result === null) {
    const description = record['description'];
    return { error: typeof description === 'string' ? description : `HTTP ${response.status}` };
  }
  const bot = result as Record<string, unknown>;
  const botId = bot['id'];
  return {
    bot: {
      id: typeof botId === 'number' || typeof botId === 'string' ? String(botId) : '',
      username: typeof bot['username'] === 'string' ? bot['username'] : '',
      name: typeof bot['first_name'] === 'string' ? bot['first_name'] : '',
    },
  };
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === 'manual' || value === 'auto' || value === 'yolo';
}

function readBindings(value: unknown): Record<string, TelegramChatBinding> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, TelegramChatBinding> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const sessionId = readString(record['sessionId']);
    const workspaceRoot = readString(record['workspaceRoot']);
    const updatedAt = readNumber(record['updatedAt']);
    if (sessionId === undefined || workspaceRoot === undefined || updatedAt === undefined) continue;
    const permission = readString(record['permission']);
    result[key] = { sessionId, workspaceRoot, updatedAt, permission };
  }
  return result;
}

function readMetrics(value: unknown): TelegramMetrics {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    updates: readNumber(record['updates']) ?? 0,
    messages: readNumber(record['messages']) ?? 0,
    errors: readNumber(record['errors']) ?? 0,
    retries: readNumber(record['retries']) ?? 0,
  };
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readPairing(value: unknown): TelegramPairingCode | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const code = readString(record['code']);
  const expiresAt = readNumber(record['expiresAt']);
  if (code === undefined || expiresAt === undefined || expiresAt <= Date.now()) return undefined;
  return { code, expiresAt };
}

async function writeJson(file: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

const stateWriteChains = new Map<string, Promise<void>>();

async function writeTelegramState(file: string, patch: Record<string, unknown>): Promise<void> {
  const previous = stateWriteChains.get(file) ?? Promise.resolve();
  const next = previous.then(async () => {
    const existing = (await readJsonObject(file)) ?? {};
    await writeJson(file, { ...existing, ...patch });
  });
  stateWriteChains.set(
    file,
    next.catch(() => undefined),
  );
  await next;
}

interface TelegramFile {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly file_size?: number;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  readonly emoji?: string;
  readonly is_animated?: boolean;
  readonly is_video?: boolean;
}

interface TelegramQuestionOption {
  readonly label: string;
  readonly description?: string;
}

interface TelegramQuestion {
  readonly question: string;
  readonly header?: string;
  readonly options: readonly TelegramQuestionOption[];
  readonly multiSelect?: boolean;
  readonly otherLabel?: string;
}

interface TelegramQuestionFlow {
  readonly token: string;
  readonly chatId: number;
  readonly questions: readonly TelegramQuestion[];
  readonly answers: Record<string, string>;
  readonly selections: Set<number>[];
  current: number;
  messageId?: number;
}

interface TelegramPendingTextReply {
  readonly kind: 'question_other' | 'plan_feedback';
  readonly id: string;
  readonly questionIndex?: number;
}

interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly message_id?: number;
    readonly media_group_id?: string;
    readonly chat: { readonly id: number };
    readonly text?: string;
    readonly caption?: string;
    readonly photo?: readonly TelegramFile[];
    readonly document?: TelegramFile;
    readonly video?: TelegramFile;
    readonly video_note?: TelegramFile;
    readonly audio?: TelegramFile;
    readonly voice?: TelegramFile;
    readonly animation?: TelegramFile;
    readonly sticker?: TelegramFile;
  };
  readonly callback_query?: {
    readonly id: string;
    readonly data?: string;
    readonly message?: {
      readonly message_id: number;
      readonly chat: { readonly id: number };
    };
  };
}

async function callTelegramApi(
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${telegramApiBase()}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
}

async function getUpdates(
  token: string,
  offset: number,
  signal: AbortSignal,
): Promise<readonly TelegramUpdate[]> {
  const response = await fetch(`${telegramApiBase()}/bot${token}/getUpdates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      offset,
      timeout: UPDATE_TIMEOUT_SECONDS,
      allowed_updates: ['message', 'callback_query'],
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout((UPDATE_TIMEOUT_SECONDS + 10) * 1000)]),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: TelegramUpdate[];
  };
  if (payload.ok !== true) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  return payload.result ?? [];
}

function readTelegramQuestions(value: unknown): readonly TelegramQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: TelegramQuestion[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const question = readString(record['question']);
    if (question === undefined) continue;
    const options: TelegramQuestionOption[] = [];
    if (Array.isArray(record['options'])) {
      for (const option of record['options']) {
        const optionRecord = asRecord(option);
        const label = readString(optionRecord['label']);
        if (label === undefined) continue;
        options.push({ label, description: readString(optionRecord['description']) });
      }
    }
    questions.push({
      question,
      header: readString(record['header']),
      options,
      multiSelect: record['multiSelect'] === true,
      otherLabel: readString(record['otherLabel']),
    });
  }
  return questions;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function deleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
  const response = await fetch(`${telegramApiBase()}/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
}

async function setMessageReaction(
  token: string,
  chatId: number,
  messageId: number,
  emoji: string,
): Promise<void> {
  await callTelegramApi(token, 'setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  });
}

async function sendChatAction(token: string, chatId: number): Promise<void> {
  await callTelegramApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
}

async function sendInlineKeyboard(
  token: string,
  chatId: number,
  text: string,
  inlineKeyboard: readonly (readonly { text: string; callback_data: string }[])[],
  options: TelegramSendOptions = {},
): Promise<number | undefined> {
  const body = telegramHtmlBody(text, options.markdown === true);
  const post = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ...payload,
        ...(options.replyToMessageId === undefined
          ? {}
          : { reply_parameters: { message_id: options.replyToMessageId, allow_sending_without_reply: true } }),
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  const send = async (payload: Record<string, unknown>): Promise<Response> => {
    const response = await post(payload);
    if (!response.ok && response.status >= 500) {
      throw new Error(`Telegram returned HTTP ${response.status}`);
    }
    return response;
  };
  let response = await withTelegramRetry('sendMessage', chatId, () => send(body));
  if (!response.ok && body.parse_mode !== undefined) {
    response = await withTelegramRetry('sendMessage', chatId, () => send({ text }));
  }
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (payload.ok !== true) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  return payload.result?.message_id;
}

async function sendForceReply(token: string, chatId: number, text: string): Promise<void> {
  const response = await fetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: { force_reply: true, selective: true },
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
}

async function editMessageReplyMarkup(
  token: string,
  chatId: number,
  messageId: number,
  inlineKeyboard: readonly (readonly { text: string; callback_data: string }[])[],
): Promise<void> {
  const response = await fetch(`${telegramApiBase()}/bot${token}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: inlineKeyboard },
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
}

async function answerCallbackQuery(
  token: string,
  callbackId: string,
  text: string,
): Promise<void> {
  await fetch(`${telegramApiBase()}/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  }).catch(() => undefined);
}

async function getTelegramFilePath(token: string, fileId: string): Promise<string> {
  const response = await fetch(`${telegramApiBase()}/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: { file_path?: string };
  };
  if (payload.ok !== true || payload.result?.file_path === undefined) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  return payload.result.file_path;
}

function fileUrl(token: string, filePath: string): string {
  return `${telegramApiBase()}/file/bot${token}/${filePath}`;
}

const TELEGRAM_GET_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

async function downloadTelegramFile(
  token: string,
  file: TelegramFile,
): Promise<{ readonly response: Response; readonly size: number }> {
  if (file.file_size !== undefined && file.file_size > TELEGRAM_GET_FILE_LIMIT_BYTES) {
    throw new Error("File is larger than Telegram's 20 MB download limit.");
  }
  const filePath = await getTelegramFilePath(token, file.file_id);
  const response = await fetch(fileUrl(token, filePath));
  if (!response.ok) throw new Error(`Telegram file HTTP ${response.status}`);
  const size = telegramFileSize(file.file_size, response);
  if (size > TELEGRAM_GET_FILE_LIMIT_BYTES) {
    throw new Error("File is larger than Telegram's 20 MB download limit.");
  }
  return { response, size };
}

function defaultTelegramName(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'telegram-image.jpg';
  if (mimeType.startsWith('video/')) return 'telegram-video.mp4';
  if (mimeType.startsWith('audio/')) return 'telegram-audio.mp3';
  return 'telegram-file.bin';
}

function telegramFileSize(declared: number | undefined, response: Response): number {
  if (declared !== undefined && declared > 0) return declared;
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : 0;
}

function safeFileName(name: string): string {
  const base = name.replaceAll(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[.]+/, '');
  return base.length === 0 ? 'telegram-file' : base.slice(0, 120);
}

async function sendDocument(token: string, chatId: number, filePath: string): Promise<void> {
  const data = await readFile(filePath);
  const name = filePath.split(sep).pop() ?? 'file';
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([new Uint8Array(data)]), name);
  const response = await fetch(`${telegramApiBase()}/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
}

interface TelegramSendOptions {
  readonly markdown?: boolean;
  readonly replyToMessageId?: number;
  readonly clearKeyboard?: boolean;
}

function splitPlainChunks(text: string, limit: number): readonly string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += limit) {
    chunks.push(text.slice(index, index + limit));
  }
  return chunks;
}

async function sendLongMessage(
  token: string,
  chatId: number,
  text: string,
  options: TelegramSendOptions = {},
): Promise<void> {
  const chunks =
    options.markdown === true
      ? splitMarkdownChunks(text, 3_000)
      : splitPlainChunks(text, 4_000);
  for (const chunk of chunks) {
    await sendMessage(token, chatId, chunk, options);
  }
}

async function withTelegramRetry<T>(
  label: string,
  chatId: number,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        retryMetricSink?.();
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  retrySink?.({ method: label, chatId, error: errorMessage(lastError) });
  throw lastError;
}

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options: TelegramSendOptions = {},
): Promise<number | undefined> {
  const body = telegramHtmlBody(text, options.markdown === true);
  const post = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ...payload,
        ...(options.replyToMessageId === undefined
          ? {}
          : { reply_parameters: { message_id: options.replyToMessageId, allow_sending_without_reply: true } }),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  const send = async (payload: Record<string, unknown>): Promise<Response> => {
    const response = await post(payload);
    if (!response.ok && response.status >= 500) {
      throw new Error(`Telegram returned HTTP ${response.status}`);
    }
    return response;
  };
  let response = await withTelegramRetry('sendMessage', chatId, () => send(body));
  if (!response.ok && body.parse_mode !== undefined) {
    response = await withTelegramRetry('sendMessage', chatId, () => send({ text }));
  }
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (payload.ok !== true) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  return payload.result?.message_id;
}

async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  options: TelegramSendOptions = {},
): Promise<void> {
  const body = telegramHtmlBody(text, options.markdown === true);
  const post = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`${telegramApiBase()}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        ...payload,
        ...(options.clearKeyboard === true
          ? { reply_markup: { inline_keyboard: [] } }
          : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  const edit = async (payload: Record<string, unknown>): Promise<Response> => {
    const response = await post(payload);
    if (!response.ok && response.status >= 500) {
      throw new Error(`Telegram returned HTTP ${response.status}`);
    }
    return response;
  };
  let response = await withTelegramRetry('editMessageText', chatId, () => edit(body));
  if (!response.ok && body.parse_mode !== undefined) {
    response = await withTelegramRetry('editMessageText', chatId, () => edit({ text }));
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  if (options.clearKeyboard === true) {
    await editMessageReplyMarkup(token, chatId, messageId, []).catch(() => undefined);
  }
}

async function finishProgress(
  token: string,
  chatId: number,
  messageId: number | undefined,
  text: string,
): Promise<void> {
  const chunks = text.length <= 3_500 ? [text] : splitMarkdownChunks(text, 3_000);
  if (messageId === undefined) {
    for (const chunk of chunks) await sendMessage(token, chatId, chunk, { markdown: true });
    return;
  }
  const first = chunks[0] ?? '';
  try {
    await editMessageText(token, chatId, messageId, first, { markdown: true });
  } catch {
    await sendLongMessage(token, chatId, text, { markdown: true });
    return;
  }
  for (const chunk of chunks.slice(1)) {
    await sendMessage(token, chatId, chunk, { markdown: true });
  }
}

function errorMessage(error: unknown): string {
  return redactTelegramSecrets(error instanceof Error ? error.message : String(error));
}

export function redactTelegramSecrets(value: string): string {
  return value
    .replaceAll(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot[redacted]')
    .replaceAll(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
}

const MCP_NAME_PREFIX = 'mcp__';

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_NAME_PREFIX);
}

export function formatMcpCallNotice(name: string, args: unknown): string | undefined {
  if (!isMcpToolName(name)) return undefined;
  const shownName = redactTelegramSecrets(name).slice(0, 120);
  let detail = '';
  try {
    const serialized = JSON.stringify(args);
    if (typeof serialized === 'string' && serialized !== '{}' && serialized !== '[]') {
      detail = ` ${redactTelegramSecrets(serialized).slice(0, 200)}`;
    }
  } catch {
    detail = '';
  }
  return `🔌 MCP call: ${shownName}${detail}`;
}

function secretsMatch(expected: string, candidate: string | undefined): boolean {
  if (candidate === undefined) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const candidateBytes = Buffer.from(candidate, 'utf8');
  return (
    expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes)
  );
}

registerScopedService(
  LifecycleScope.App,
  ITelegramConnectorService,
  TelegramConnectorService,
  ScopeActivation.OnDemand,
  'telegram',
);
