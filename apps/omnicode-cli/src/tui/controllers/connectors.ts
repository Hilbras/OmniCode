import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { Component, Focusable } from '@hilbras/omnicode-tui';
import { Jimp } from 'jimp';

import { ApiKeyInputDialogComponent } from '../components/dialogs/api-key-input-dialog';
import {
  CatalogBrowserApp,
  type CatalogBrowserAction,
  type CatalogBrowserEntry,
  type CatalogBrowserProps,
} from '../components/dialogs/catalog-browser';
import {
  closeCatalogBrowser,
  openCatalogBrowser,
  type CatalogBrowserHost,
} from './catalog-browser';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';

interface TelegramBot {
  readonly id: string;
  readonly username: string;
  readonly name: string;
}

interface TelegramPairing {
  readonly code: string;
  readonly expiresAt: number;
  readonly deepLink?: string;
}

interface TelegramStatus {
  readonly configured: boolean;
  readonly bot?: TelegramBot;
  readonly error?: string;
  readonly running: boolean;
  readonly allowedChatIds: readonly number[];
  readonly pairing?: TelegramPairing;
  readonly state?: string;
  readonly lastError?: string;
}

interface TelegramConfig {
  readonly botToken?: string;
  readonly allowedChatIds?: readonly number[];
  readonly [key: string]: unknown;
}

const TELEGRAM_TIMEOUT_MS = 20_000;

export class ConnectorsController {
  private busy = false;
  private closed = false;
  private component: CatalogBrowserApp | undefined;
  private statusMessage: string | undefined;
  private status: TelegramStatus = { configured: false, running: false, allowedChatIds: [] };
  private dialog: (Component & Focusable) | undefined;
  private dialogTakeover: ScreenTakeover | undefined;

  constructor(private readonly host: CatalogBrowserHost) {}

  async show(): Promise<void> {
    if (this.busy || this.host.state.connectorsBrowser !== undefined) return;
    this.closed = false;
    this.statusMessage = 'Checking Telegram status…';
    this.open();
    await this.refreshStatus();
  }

  close(): void {
    this.closed = true;
    this.endDialog();
    closeCatalogBrowser(
      this.host,
      this.host.state.connectorsBrowser,
      this.host.setConnectorsBrowser.bind(this.host),
    );
  }

  private open(): void {
    this.component = openCatalogBrowser(
      this.host,
      this.buildProps(),
      this.host.setConnectorsBrowser.bind(this.host),
    );
  }

  private buildProps(): CatalogBrowserProps {
    return {
      title: 'Connectors',
      entries: [telegramEntry(this.status)],
      error: undefined,
      emptyMessage: 'No connectors available.',
      status: this.statusMessage,
      searchable: false,
      variant: 'cards',
      onCancel: () => this.close(),
      onAction: (entry, action) => this.runAction(entry, action),
      onRefresh: () => void this.refreshStatus(),
    };
  }

  private runAction(entry: CatalogBrowserEntry, action: CatalogBrowserAction): void {
    if (entry.id !== 'telegram') return;
    switch (action.id) {
      case 'setup':
        this.promptToken();
        return;
      case 'pair-chat':
        void this.pairChat();
        return;
      case 'start-bot':
        void this.startBot();
        return;
      case 'stop-bot':
        void this.stopBot();
        return;
      default:
        this.setStatus(`Unknown Telegram action: ${action.id}`);
    }
  }

  private setStatus(message: string): void {
    this.statusMessage = message;
    if (this.component === undefined) return;
    this.component.setProps(this.buildProps());
    this.host.state.ui.requestRender(true);
  }

  private async refreshStatus(message?: string): Promise<void> {
    if (this.closed) return;
    this.status = await this.loadStatus();
    if (this.closed) return;
    this.statusMessage = message;
    if (this.component === undefined) this.open();
    else {
      this.component.setProps(this.buildProps());
      this.host.state.ui.requestRender(true);
    }
  }

  private async loadStatus(): Promise<TelegramStatus> {
    try {
      const status = await this.host.harness.getTelegramConnectorStatus();
      return {
        configured: status.hasToken,
        bot: status.bot,
        error: status.error ?? status.lastError,
        running: status.running,
        allowedChatIds: status.allowedChatIds,
        pairing: status.pairing,
        state: status.state,
        lastError: status.lastError,
      };
    } catch (error) {
      return {
        configured: false,
        running: false,
        allowedChatIds: [],
        error: errorMessage(error),
      };
    }
  }

  private promptToken(): void {
    const dialog = new ApiKeyInputDialogComponent(
      'Telegram',
      [
        'Paste the bot token from @BotFather.',
        'OmniCode will validate the bot, set its name to OmniCode, and upload the OmniCode logo.',
      ],
      (result) => {
        this.endDialog();
        if (result.kind === 'cancel') {
          this.setStatus('Telegram setup cancelled.');
          return;
        }
        void this.setup(result.value);
      },
      {
        title: 'Set up Telegram bot',
        mask: true,
        emptyHint: 'Telegram bot token cannot be empty.',
      },
    );
    this.mountDialog(dialog);
  }

  private async setup(token: string): Promise<void> {
    const botToken = token.trim();
    if (botToken === '') {
      this.setStatus('Telegram bot token cannot be empty.');
      return;
    }
    try {
      this.setStatus('Checking the Telegram bot token…');
      const me = normalizeBot(await callTelegram<TelegramBot>(botToken, 'getMe'));

      this.setStatus(`Connected as @${me.username}. Setting bot name…`);
      await callTelegram(botToken, 'setMyName', { name: 'OmniCode' });

      this.setStatus('Uploading the OmniCode logo…');
      await uploadProfilePhoto(botToken);

      this.setStatus('Saving Telegram settings…');
      await saveTelegramToken(botToken);

      this.setStatus('Starting the Telegram bot…');
      await this.host.harness.startTelegramBot();
      const pairing = await this.host.harness.createTelegramPairingCode();
      this.status = await this.loadStatus();
      this.setStatus(
        [
          `Telegram bot @${me.username} is ready. Name: OmniCode. Logo updated.`,
          `Pairing code: ${pairing.code}`,
          pairing.deepLink === undefined
            ? 'Send /start <code> to the bot in Telegram.'
            : `Open: ${pairing.deepLink}`,
          'The code expires in 10 minutes.',
        ].join('\n'),
      );
    } catch (error) {
      this.setStatus(`Telegram setup failed: ${errorMessage(error)}`);
    }
  }

  private async pairChat(): Promise<void> {
    this.setStatus('Starting the Telegram bot and creating a pairing code…');
    try {
      await this.host.harness.startTelegramBot();
      const pairing = await this.host.harness.createTelegramPairingCode();
      this.status = await this.loadStatus();
      this.setStatus(
        [
          `Pairing code: ${pairing.code}`,
          pairing.deepLink === undefined
            ? 'Send /start <code> to the bot in Telegram.'
            : `Open: ${pairing.deepLink}`,
          'The code expires in 10 minutes.',
        ].join('\n'),
      );
    } catch (error) {
      this.setStatus(`Pairing failed: ${errorMessage(error)}`);
    }
  }

  private async startBot(): Promise<void> {
    this.setStatus('Starting the Telegram bot…');
    try {
      await this.host.harness.startTelegramBot();
      await this.refreshStatus('Telegram bot started.');
    } catch (error) {
      this.setStatus(`Could not start the bot: ${errorMessage(error)}`);
    }
  }

  private async stopBot(): Promise<void> {
    this.setStatus('Stopping the Telegram bot…');
    try {
      await this.host.harness.stopTelegramBot();
      await this.refreshStatus('Telegram bot stopped.');
    } catch (error) {
      this.setStatus(`Could not stop the bot: ${errorMessage(error)}`);
    }
  }

  private mountDialog(dialog: Component & Focusable): void {
    this.endDialog();
    this.dialog = dialog;
    this.dialogTakeover = beginScreenTakeover(this.host.state.ui, dialog);
    this.host.state.ui.setFocus(dialog);
    this.host.state.ui.requestRender(true);
  }

  private endDialog(): void {
    if (this.dialogTakeover !== undefined) {
      endScreenTakeover(this.host.state.ui, this.dialogTakeover);
      this.dialogTakeover = undefined;
    }
    this.dialog = undefined;
    const browser = this.host.state.connectorsBrowser;
    if (browser !== undefined) {
      this.host.state.ui.setFocus(browser.component);
      this.host.state.ui.requestRender(true);
    }
  }
}

function telegramEntry(status: TelegramStatus): CatalogBrowserEntry {
  const ready =
    status.configured &&
    status.error === undefined &&
    status.running &&
    status.allowedChatIds.length > 0;
  const actions: CatalogBrowserAction[] = [
    {
      id: 'setup',
      label: 'Set up bot token',
      description: 'Validate the token, set the OmniCode name and logo',
    },
  ];
  if (status.configured) {
    actions.push({
      id: status.running ? 'stop-bot' : 'start-bot',
      label: status.running ? 'Stop bot' : 'Start bot',
      description: status.running ? 'Stop Telegram polling' : 'Start Telegram polling',
    });
    actions.push({
      id: 'pair-chat',
      label: 'Pair a chat',
      description: 'Create a one-time pairing code and deep link',
    });
  }

  const label = !status.configured
    ? 'not configured'
    : status.error !== undefined
      ? 'error'
      : !status.running
        ? 'bot offline'
        : status.allowedChatIds.length === 0
          ? 'awaiting pairing'
          : 'connected';

  return {
    id: 'telegram',
    name: 'Telegram',
    detail: 'Drive sessions from a Telegram chat',
    group: 'Messaging',
    status: label,
    statusTone: ready ? 'ok' : status.error !== undefined ? 'error' : status.configured ? 'warn' : 'muted',
    badges: ['connector', `${status.allowedChatIds.length} chat${status.allowedChatIds.length === 1 ? '' : 's'}`],
    capabilities: [
      'bot validation',
      'bot name: OmniCode',
      'logo upload',
      status.running ? 'polling active' : 'polling stopped',
    ],
    setupHint:
      status.error ??
      status.lastError ??
      (status.pairing === undefined
        ? ready
          ? 'Connected. Pair another chat or reconfigure the bot.'
          : 'Set up the bot token, then pair a chat.'
        : `Pairing code: ${status.pairing.code}`),
    actions,
  };
}

function normalizeBot(bot: TelegramBot): TelegramBot {
  return {
    id: String(bot.id),
    username: String(bot.username ?? ''),
    name: String(bot.name ?? ''),
  };
}

async function readTelegramConfig(): Promise<TelegramConfig | undefined> {
  try {
    const raw = await readFile(telegramConfigPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as TelegramConfig)
      : undefined;
  } catch {
    return undefined;
  }
}

async function saveTelegramToken(token: string): Promise<void> {
  const path = telegramConfigPath();
  const existing = (await readTelegramConfig()) ?? {};
  const next: TelegramConfig = { ...existing, botToken: token };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function telegramConfigPath(): string {
  const home = process.env['OMNICODE_HOME'] ?? join(homedir(), '.omnicode');
  return join(home, 'telegram.json');
}

async function uploadProfilePhoto(token: string): Promise<void> {
  const logoPath = findLogoPath();
  const image = await Jimp.read(logoPath);
  const jpeg = await image.getBuffer('image/jpeg', { quality: 90 });
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://logo' }));
  form.append('logo', new Blob([jpeg], { type: 'image/jpeg' }), 'omnicode-logo.jpg');

  const response = await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
  };
  if (payload.ok !== true) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
}

function findLogoPath(): string {
  const candidates = [
    resolve(process.cwd(), 'public/icon.png'),
    resolve(process.cwd(), '../../public/icon.png'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('OmniCode logo not found at public/icon.png');
}

async function callTelegram<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: T;
  };
  if (payload.ok !== true) {
    throw new Error(payload.description ?? `Telegram returned HTTP ${response.status}`);
  }
  return payload.result as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
