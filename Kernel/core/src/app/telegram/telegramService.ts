import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { LifecycleScope } from '#/app/scopes';

import { ITelegramConnectorService, type TelegramStatusOptions } from './telegram';
import type {
  TelegramBotIdentity,
  TelegramConnectorState,
  TelegramConnectorStatus,
  TelegramSettingsInput,
} from './types';

const CONFIG_FILE = 'telegram.json';
const STATE_FILE = 'telegram-state.json';
const BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN';
const HEARTBEAT_STALE_MS = 90_000;
const PROBE_TIMEOUT_MS = 10_000;

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

  constructor(@IBootstrapService private readonly bootstrap: IBootstrapService) {}

  private get configPath(): string {
    return join(this.bootstrap.homeDir, CONFIG_FILE);
  }

  private get statePath(): string {
    return join(this.bootstrap.homeDir, STATE_FILE);
  }

  async status(options: TelegramStatusOptions = {}): Promise<TelegramConnectorStatus> {
    const config = await readJsonObject(this.configPath);
    const token = effectiveToken(config);
    const allowedChatIds = readChatIds(config?.['allowedChatIds']);
    const lifecycle = await this.readLifecycle();
    const base: TelegramConnectorStatus = {
      state: connectorState(token !== '', allowedChatIds),
      configPath: this.configPath,
      hasToken: token !== '',
      allowedChatIds,
      running: lifecycle.running,
      pid: lifecycle.pid,
      heartbeatAt: lifecycle.heartbeatAt,
    };
    if (options.probe !== true || token === '') return base;
    const probe = await probeBot(token);
    return { ...base, bot: probe.bot, error: probe.error };
  }

  async saveSettings(input: TelegramSettingsInput): Promise<TelegramConnectorStatus> {
    const config = (await readJsonObject(this.configPath)) ?? {};
    const next: Record<string, unknown> = { ...config };
    if (input.botToken !== undefined) next['botToken'] = input.botToken.trim();
    if (input.allowedChatIds !== undefined) next['allowedChatIds'] = [...input.allowedChatIds];
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return this.status();
  }

  private async readLifecycle(): Promise<TelegramLifecycle> {
    const state = await readJsonObject(this.statePath);
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

function effectiveToken(config: Record<string, unknown> | undefined): string {
  const fromEnv = process.env[BOT_TOKEN_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  const token = config?.['botToken'];
  return typeof token === 'string' ? token.trim() : '';
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

async function probeBot(token: string): Promise<TelegramProbe> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
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

registerScopedService(
  LifecycleScope.App,
  ITelegramConnectorService,
  TelegramConnectorService,
  ScopeActivation.OnDemand,
  'telegram',
);
