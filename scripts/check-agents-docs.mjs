#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOT_GUIDE = join(ROOT, 'AGENTS.md');
const failures = [];

if (!existsSync(ROOT_GUIDE)) failures.push('root AGENTS.md is missing');
const text = existsSync(ROOT_GUIDE) ? readFileSync(ROOT_GUIDE, 'utf8') : '';

function findAgentGuides(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findAgentGuides(full));
    else if (entry.isFile() && entry.name === 'AGENTS.md') found.push(full);
  }
  return found;
}

for (const guide of findAgentGuides(ROOT)) {
  if (/\bKernel\//.test(readFileSync(guide, 'utf8'))) {
    failures.push(`${relative(ROOT, guide)} references stale Kernel/ paths`);
  }
}

for (const required of [
  'CLAUDE.md',
  'GEMINI.md',
  'AGENT.md',
  'CONVENTIONS.md',
  '.cursor/rules/omnicode.mdc',
  '.cursorrules',
  '.github/copilot-instructions.md',
  '.windsurf/rules/omnicode.md',
  '.clinerules/omnicode.md',
  '.roo/rules/omnicode.md',
  '.continue/rules/omnicode.md',
  '.aider.conf.yml',
  '.amp/AGENT.md',
]) {
  if (!existsSync(join(ROOT, required))) failures.push(`compatibility file missing: ${required}`);
}

const paths = new Set(text.match(/`((?:apps|packages|scripts|docs)\/[^`\s]+)`/g) ?? []);
for (const token of paths) {
  const path = token.slice(1, -1).replace(/\/$/, '');
  if (path.includes('<') || path.includes('*')) continue;
  if (path === 'apps/omnicode') continue;
  if (!existsSync(join(ROOT, path))) failures.push(`root AGENTS.md references missing path: ${path}`);
}

// A guide that tells an agent to run `pnpm <script>` must name a script that exists,
// either at the root or — for a package guide — in the package that owns the guide.
// `packages/minidb/AGENTS.md` naming `bench:open` is correct as long as minidb defines
// it; a root-level name that no package.json defines is a command that fails when
// someone follows it.
const PNPM_BUILTINS = new Set([
  'add', 'install', 'pack', 'publish', 'exec', 'dlx', 'run', 'remove', 'update', 'why',
  'list', 'outdated', 'patch', 'prune', 'link', 'unlink', 'import', 'rebuild', 'store',
  'root', 'bin', 'env', 'config', 'setup', 'deploy', 'audit', 'licenses', 'dedupe',
  'fetch', 'doctor', 'test', 'typecheck', 'build', 'lint',
]);
const rootScripts = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts));

for (const guide of findAgentGuides(ROOT)) {
  const source = readFileSync(guide, 'utf8');
  const ownScripts = new Set();
  for (let dir = dirname(guide); dir.startsWith(ROOT); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      for (const name of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {})) {
        ownScripts.add(name);
      }
      break;
    }
    if (dir === ROOT) break;
  }
  for (const match of source.matchAll(/`pnpm (?:run )?([a-z][a-z0-9:_-]*)/g)) {
    const script = match[1];
    if (PNPM_BUILTINS.has(script)) continue;
    if (rootScripts.has(script) || ownScripts.has(script)) continue;
    failures.push(`${relative(ROOT, guide)} tells the reader to run \`pnpm ${script}\`, which no package.json defines`);
  }
}

if (failures.length > 0) {
  console.error('agent docs check: failed');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`agent docs check: OK (${String(paths.size)} referenced paths)`);
