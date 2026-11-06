import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_SCRIPT = join('plugins', 'managed', 'omnicode-telegram', 'bin', 'omnicode-telegram.mjs');
const LOG_FILE = join('logs', 'telegram-bridge.log');

interface TelegramConfig {
  readonly botToken?: string;
  readonly allowedChatIds?: readonly number[];
}

export interface TelegramBridgeHandle {
  readonly pid: number | undefined;
  stop(): void;
}

function omnicodeHome(): string {
  return process.env['OMNICODE_HOME'] ?? join(homedir(), '.omnicode');
}

function readConfig(): TelegramConfig | undefined {
  try {
    return JSON.parse(readFileSync(join(omnicodeHome(), 'telegram.json'), 'utf8')) as TelegramConfig;
  } catch {
    return undefined;
  }
}

export function startTelegramBridge(): TelegramBridgeHandle | undefined {
  const config = readConfig();
  if (typeof config?.botToken !== 'string' || config.botToken === '') return undefined;
  if (!Array.isArray(config.allowedChatIds) || config.allowedChatIds.length === 0) return undefined;
  const script = join(omnicodeHome(), PLUGIN_SCRIPT);
  if (!existsSync(script)) return undefined;
  let log: ReturnType<typeof createWriteStream> | undefined;
  try {
    mkdirSync(join(omnicodeHome(), 'logs'), { recursive: true });
    log = createWriteStream(join(omnicodeHome(), LOG_FILE), { flags: 'a' });
  } catch {
    log = undefined;
  }
  const child: ChildProcess = spawn(process.execPath, [script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.pipe(log ?? process.stdout);
  child.stderr?.pipe(log ?? process.stderr);
  child.once('exit', (code) => {
    log?.end();
    if (code !== 0 && code !== null) console.warn(`[telegram] bridge exited with code ${String(code)}`);
  });
  child.once('error', (error) => {
    log?.end();
    console.warn(`[telegram] bridge failed to start: ${error.message}`);
  });
  return {
    pid: child.pid,
    stop: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}