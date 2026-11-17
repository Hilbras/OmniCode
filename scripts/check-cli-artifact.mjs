#!/usr/bin/env node
/**
 * Smoke-test the built CLI artifact.
 *
 * Unit tests run `src` through Vitest aliases, so nothing exercises what ships.
 * That is how the bundle shipped with every workspace package external: the
 * built CLI resolved `@hilbras/omnicode-sdk` to TypeScript source and died on
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, while `@hilbras/omnicode-sdk` is private
 * and would not exist in a published install either.
 *
 * Two checks, both against the artifact:
 *   1. no bare import of a workspace package remains in the bundle;
 *   2. the binary starts and reports the version in its own package.json.
 *
 * Run after `pnpm --filter @omnicode/cli build`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname.replace(/[\\/]scripts$/, '');
const cliRoot = join(root, 'apps', 'omnicode-cli');
const entry = join(cliRoot, 'dist', 'main.mjs');

if (!existsSync(entry)) {
  process.stderr.write(
    `CLI artifact check: FAILED — ${entry} is missing. Build it first:\n  pnpm --filter @omnicode/cli build\n`,
  );
  process.exit(1);
}

const bundle = readFileSync(entry, 'utf8');
const INTERNAL = /^(@hilbras\/|@omnicode\/cli-)/;
const leaks = new Set();

for (const match of bundle.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']/g)) {
  if (INTERNAL.test(match[1])) leaks.add(match[1]);
}
for (const match of bundle.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
  if (INTERNAL.test(match[1])) leaks.add(match[1]);
}
for (const match of bundle.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
  if (INTERNAL.test(match[1])) leaks.add(match[1]);
}

const version = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')).version;
const run = spawnSync(process.execPath, [entry, '--version'], { encoding: 'utf8', timeout: 120_000 });
const reported = (run.stdout ?? '').trim();

if (leaks.size > 0) {
  process.stderr.write('CLI artifact check: FAILED — workspace packages are still external:\n');
  for (const leak of [...leaks].sort((a, b) => a.localeCompare(b))) {
    process.stderr.write(`  - ${leak}\n`);
  }
  process.stderr.write('Bundle them (tsdown noExternal) so a published install can start.\n');
  process.exit(1);
}

if (run.status !== 0) {
  process.stderr.write(
    `CLI artifact check: FAILED — \`node ${entry} --version\` exited ${String(run.status)}.\n`,
  );
  if (run.stderr !== undefined && run.stderr !== '') process.stderr.write(run.stderr);
  process.exit(1);
}

if (reported !== version) {
  process.stderr.write(
    `CLI artifact check: FAILED — artifact reports "${reported}" but package.json says "${version}".\n`,
  );
  process.exit(1);
}

// These groups pull the heaviest packages (ACP host, server, vis, TUI). They
// loaded lazily before the bundle inlined them, so they are the paths a future
// bundling change breaks first.
const SMOKE_GROUPS = ['acp', 'web', 'vis'];
for (const group of SMOKE_GROUPS) {
  const help = spawnSync(process.execPath, [entry, group, '--help'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  const head = (help.stdout ?? '').trim().split('\n')[0] ?? '';
  if (help.status !== 0 || !head.startsWith(`Usage: omnicode ${group}`)) {
    process.stderr.write(
      `CLI artifact check: FAILED — \`omnicode ${group} --help\` exited ${String(help.status)} with "${head}".\n`,
    );
    if (help.stderr !== undefined && help.stderr !== '') process.stderr.write(help.stderr);
    process.exit(1);
  }
}

process.stdout.write(`CLI artifact check: OK (self-contained bundle, reports ${version})\n`);
