#!/usr/bin/env node
/**
 * Runs the Omnicode CLI from this checkout instead of an installed binary.
 *
 * Author: Hilbras.
 *
 * Why a wrapper script rather than a plain package.json script: pnpm forwards
 * the `--` separator as a literal argument, so `pnpm run omnicode -- provider list`
 * would hand the CLI `--` as its first argument and it would fail on an
 * "unknown command". Dropping a leading `--` makes both forms work.
 *
 * Also points OMNICODE_HOME at a repo-local directory so the dev run never
 * reads or writes the installed `omnicode`'s config (~/.omnicode/config.toml).
 * Set OMNICODE_HOME yourself to override, e.g.
 *   OMNICODE_HOME=$HOME/.omnicode node scripts/omnicode-dev.mjs provider list
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// `import.meta.dirname` (Node >= 20.11) rather than
// dirname(fileURLToPath(import.meta.url)) — same result, and it keeps the
// type-aware lint pass from flagging the helper imports as unused.
const repoRoot = resolve(import.meta.dirname, '..');
const appRoot = resolve(repoRoot, 'apps/omnicode');

process.env.OMNICODE_HOME ??= resolve(repoRoot, '.omnicode-dev-home');
mkdirSync(process.env.OMNICODE_HOME, { recursive: true });

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const child = spawn(
  'npx',
  [
    'tsx',
    '--tsconfig',
    './tsconfig.dev.json',
    '--import',
    '../../build/register-raw-text-loader.mjs',
    './src/main.ts',
    ...argv,
  ],
  { cwd: appRoot, stdio: 'inherit', env: process.env },
);

child.on('exit', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 0));
});