import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const READY_TIMEOUT_MS = 60_000;
const DESKTOP_SERVER_PORT = 58637;
const SHUTDOWN_GRACE_MS = 5_000;
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const READY_URL_PATTERN = /(https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:#token=[^\s]+)?)/;

export interface ServerHandle {
  readonly url: string;
  readonly origin: string;
  readonly token: string | undefined;
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

export interface StartServerOptions {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly onLog: (line: string) => void;
}

export function resolveServerBinary(opts: StartServerOptions): string {
  const override = process.env['OMNICODE_DESKTOP_SERVER_BIN'];
  if (override !== undefined && override.length > 0) return override;
  const exe = process.platform === 'win32' ? 'omnicode.exe' : 'omnicode';
  if (opts.packaged) return join(opts.resourcesPath, 'server', exe);
  return resolve(opts.appPath, '..', 'omnicode', 'dist-native', 'bin', `${process.platform}-${process.arch}`, exe);
}

export function parseReadyUrl(line: string): string | undefined {
  return READY_URL_PATTERN.exec(line.replace(ANSI_PATTERN, ''))?.[1];
}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const binary = resolveServerBinary(opts);
  if (!existsSync(binary)) {
    throw new Error(`Omnicode server binary not found at ${binary}.`);
  }
  const child = spawn(
    binary,
    ['web', '--no-open', '--port', String(DESKTOP_SERVER_PORT), '--log-level', 'warn', '--web-title', 'Omnicode'],
    {
      cwd: homedir(),
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const exited = new Promise<number | null>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
    child.once('error', () => resolveExit(null));
  });
  const url = await waitForReadyUrl(child, exited, opts.onLog);
  const parsed = new URL(url);
  const token = parsed.hash.startsWith('#token=') ? decodeURIComponent(parsed.hash.slice('#token='.length)) : undefined;
  return {
    url,
    origin: parsed.origin,
    token,
    exited,
    stop: () => stopServer(child, exited, parsed.origin, token),
  };
}

function waitForReadyUrl(
  child: ChildProcess,
  exited: Promise<number | null>,
  onLog: (line: string) => void,
): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      settle(() => reject(new Error('Timed out waiting for the Omnicode server to start.')));
      child.kill();
    }, READY_TIMEOUT_MS);
    const consume = (stream: NodeJS.ReadableStream | null): void => {
      if (stream === null) return;
      let buffered = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          onLog(line);
          const url = parseReadyUrl(line);
          if (url !== undefined) settle(() => resolveUrl(url));
        }
      });
    };
    consume(child.stdout);
    consume(child.stderr);
    child.once('error', (error) => settle(() => reject(error)));
    void exited.then((code) =>
      settle(() => reject(new Error(`Omnicode server exited before it was ready (code ${code}).`))),
    );
  });
}

async function stopServer(
  child: ChildProcess,
  exited: Promise<number | null>,
  origin: string,
  token: string | undefined,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    await fetch(`${origin}/api/v1/shutdown`, {
      method: 'POST',
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SHUTDOWN_GRACE_MS),
    });
  } catch {
    child.kill();
  }
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(true), SHUTDOWN_GRACE_MS)),
  ]);
  if (timedOut) child.kill('SIGKILL');
}
