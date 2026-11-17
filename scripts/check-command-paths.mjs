#!/usr/bin/env node
/**
 * Verify the test paths named by scripts still exist.
 *
 * Three gates in this repo were found pointing at nothing in one session: lint
 * was never invoked by CI, nothing ran the built CLI, and preflight asked the
 * engine to run `test/os/backends/node-local/tools/bash.test.ts` long after the
 * test moved to `features-integration` — so preflight failed with
 * `No test files found` instead of testing anything.
 *
 * This scans every workspace `package.json` script and the step list in
 * `scripts/preflight.mjs`, resolves each `--filter` to a package directory, and
 * fails when a named test path is not there.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname.replace(/[\\/]scripts$/, '');
const TEST_PATH = /(?:^|[\s'"])((?:test|src)\/[\w./-]+\.(?:test|e2e|integration)\.tsx?)(?=$|[\s'"])/g;

function workspaceDirs() {
  const dirs = new Set();
  for (const base of ['packages', 'apps']) {
    for (const entry of readdirSync(join(root, base))) {
      const rel = `${base}/${entry}`;
      if (statSync(join(root, rel)).isDirectory() && existsSync(join(root, rel, 'package.json'))) {
        dirs.add(rel);
      }
    }
  }
  for (const nested of ['apps/omnicode-vis/server', 'apps/omnicode-vis/web']) {
    if (existsSync(join(root, nested, 'package.json'))) dirs.add(nested);
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

const dirs = workspaceDirs();
const byName = new Map();
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  if (typeof manifest.name === 'string') byName.set(manifest.name, dir);
}

const problems = [];
const checked = [];

function checkCommand(where, command, dir) {
  for (const match of command.matchAll(TEST_PATH)) {
    const path = match[1];
    checked.push(path);
    if (!existsSync(join(root, dir, path))) {
      problems.push(`${where}: names ${path}, which is not in ${dir}`);
    }
  }
}

for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (typeof command === 'string') checkCommand(`${dir} script "${name}"`, command, dir);
  }
}

const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const [name, command] of Object.entries(rootManifest.scripts ?? {})) {
  if (typeof command === 'string') checkCommand(`root script "${name}"`, command, '.');
}

const preflightPath = join(root, 'scripts', 'preflight.mjs');
if (existsSync(preflightPath)) {
  const source = readFileSync(preflightPath, 'utf8');
  for (const step of source.matchAll(/name:\s*'([^']+)'[\s\S]{0,400}?args:\s*\[([\s\S]*?)\]/g)) {
    const [, stepName, argsSource] = step;
    const args = [...argsSource.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    const filterAt = args.indexOf('--filter');
    const filter = filterAt >= 0 ? args[filterAt + 1] : undefined;
    const dir = filter === undefined ? '.' : byName.get(filter);
    if (dir === undefined) {
      problems.push(`preflight step "${stepName}": --filter ${String(filter)} is not a workspace package`);
      continue;
    }
    checkCommand(`preflight step "${stepName}"`, args.join(' '), dir);
  }
}

if (problems.length > 0) {
  process.stderr.write(`command path check: FAILED (${String(problems.length)})\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `command path check: OK (${String(dirs.length)} packages, ${String(new Set(checked).size)} test paths resolve)\n`,
);
