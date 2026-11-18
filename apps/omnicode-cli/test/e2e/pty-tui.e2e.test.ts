/**
 * Interactive TUI smoke over a real PTY, opt-in only.
 *
 * The rest of `test/tui/` renders components in-process, so the one thing it
 * cannot see is whether the terminal app actually starts, draws and reads keys
 * as a terminal — the trust gate, the banner, the input box. This suite drives
 * the real CLI (the same `src/main.ts` the dev script runs) through a PTY.
 *
 * Gated, because booting the CLI takes tens of seconds and needs a pty:
 *
 *   OMNICODE_E2E=1 pnpm --filter @omnicode/cli exec vitest run test/e2e/pty-tui.e2e.test.ts
 *
 * It cannot run the built bundle in this workspace: `node dist/main.mjs` fails
 * with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, because workspace packages export
 * their TypeScript source and Node's strip-only mode rejects parameter
 * properties. So this uses the dev entry (`tsx src/main.ts`), which is also what
 * `scripts/omnicode-dev.mjs` does.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import type { IPty } from 'node-pty';
import xterm from '@xterm/headless';

const require = createRequire(import.meta.url);
const XtermTerminal = xterm.Terminal;

const ENABLED = process.env['OMNICODE_E2E'] === '1';
const APP_ROOT = join(import.meta.dirname, '..', '..');
const REPO_ROOT = join(APP_ROOT, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const TRUST_PROMPT = 'Trust this folder?';
const READY_MARKER = 'No session yet';
const BOOT_TIMEOUT_MS = 120_000;
const EXIT_TIMEOUT_MS = 30_000;

const homes: string[] = [];
const terminals: IPty[] = [];

interface VisualGrid {
  grid(): Promise<string[]>;
}

function spawnCli(): {
  terminal: IPty;
  output: () => string;
  exited: Promise<number | null>;
  visual: VisualGrid;
} {
  const home = mkdtempSync(join(tmpdir(), 'omnicode-pty-'));
  homes.push(home);
  const { spawn } = require('node-pty') as typeof import('node-pty');
  const terminal = spawn(
    TSX,
    [
      '--tsconfig',
      './tsconfig.dev.json',
      '--import',
      '../../build/register-raw-text-loader.mjs',
      './src/main.ts',
    ],
    {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: APP_ROOT,
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: home,
        OMNICODE_HOME: join(home, '.omnicode-dev'),
        TERM: 'xterm-256color',
      },
    },
  );
  terminals.push(terminal);
  let captured = '';
  const screen = new XtermTerminal({ cols: 100, rows: 30, disableStdin: true, allowProposedApi: true });
  terminal.onData((data) => {
    captured += data;
    screen.write(data);
  });
  const exited = new Promise<number | null>((resolve) => {
    terminal.onExit(({ exitCode }) => {
      resolve(exitCode);
    });
  });
  const visual: VisualGrid = {
    async grid(): Promise<string[]> {
      await new Promise<void>((resolve) => screen.write('', () => resolve()));
      const lines: string[] = [];
      for (let y = 0; y < 30; y += 1) {
        lines.push(screen.buffer.active.getLine(y)?.translateToString(true) ?? '');
      }
      while (lines.length > 0 && lines.at(-1) === '') lines.pop();
      return lines;
    },
  };
  return { terminal, output: () => captured, exited, visual };
}

function normalizeGrid(lines: readonly string[], home: string): string[] {
  const noise = /^\(node:\d+\)|^Hooks\(\)`|^\(Use `node --trace-deprecation/;
  return lines
    .filter((line) => !noise.test(line.trim()))
    .map((line) =>
      line
        .replaceAll(home, '<home>')
        .replaceAll(REPO_ROOT, '<repo>')
        .replaceAll(APP_ROOT, '<app>')
        .replace(/Version:\s+\d+\.\d+\.\d+/g, 'Version: <version>')
        .replace(/http:\/\/127\.0\.0\.1:\d+/g, '<url>')
        .replace(/\[\+\d+ -\d+\]/g, '[<git>]')
        .replace(/\/tmp\/[^\s]+/g, '<tmp>'),
    );
}

/** Strip ANSI so assertions can look for UI text instead of escape codes. */
function plain(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

async function waitForOutput(
  output: () => string,
  marker: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (plain(output()).includes(marker)) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  return false;
}

async function waitForExit(exited: Promise<number | null>, timeoutMs: number): Promise<number | null> {
  return Promise.race([
    exited,
    new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, timeoutMs);
    }),
  ]);
}

afterEach(() => {
  for (const terminal of terminals.splice(0)) {
    try {
      terminal.kill();
    } catch {}
  }
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe.skipIf(!ENABLED)('interactive TUI over a PTY', () => {
  it('renders the trust gate, then the TUI, and exits on /exit', async () => {
    const { terminal, output, exited, visual } = spawnCli();

    expect(
      await waitForOutput(output, TRUST_PROMPT, BOOT_TIMEOUT_MS),
      `the CLI never drew the workspace trust gate; output was:\n${plain(output()).slice(-1500)}`,
    ).toBe(true);

    expect(normalizeGrid(await visual.grid(), homes.at(-1) ?? '')).toMatchFileSnapshot(
      './__snapshots__/tui-trust-grid.txt',
    );

    terminal.write('\r');

    expect(
      await waitForOutput(output, READY_MARKER, BOOT_TIMEOUT_MS),
      `the TUI never became ready after trusting the workspace; output was:\n${plain(output()).slice(-1500)}`,
    ).toBe(true);
    expect(plain(output())).toContain('Version:');

    const readyGrid = normalizeGrid(await visual.grid(), homes.at(-1) ?? '').join('\n');
    expect(readyGrid).toContain('No session yet');
    expect(readyGrid).toContain('╭');
    expect(readyGrid).toContain('Version: <version>');

    terminal.write('/exit\r');
    expect(await waitForExit(exited, EXIT_TIMEOUT_MS)).toBe(0);
  }, BOOT_TIMEOUT_MS + EXIT_TIMEOUT_MS + 30_000);
});
