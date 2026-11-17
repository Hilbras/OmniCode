#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = import.meta.dirname.replace(/[\\/]scripts$/, '');
const allowlistPath = join(root, 'scripts', 'deps-consistency-allowlist.json');

const violations = [];
const notes = [];

function fail(message) {
  violations.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspaceDirs() {
  const globs = [];
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split('\n');
  let inPackages = false;
  for (const line of yaml) {
    if (line.startsWith('packages:')) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[a-zA-Z]/.test(line)) break;
    if (!inPackages) continue;
    const entry = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (entry) globs.push(entry[1]);
  }
  const dirs = new Set();
  for (const glob of globs) {
    if (!glob.includes('*')) {
      if (existsSync(join(root, glob, 'package.json'))) dirs.add(glob);
      else fail(`workspace pattern ${glob} names a directory with no package.json`);
      continue;
    }
    if (!glob.endsWith('/*')) {
      fail(`workspace pattern ${glob} uses a wildcard this guard does not expand; keep it to a trailing /*`);
      continue;
    }
    const base = glob.slice(0, -2);
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) {
      fail(`workspace pattern ${glob} names a missing directory`);
      continue;
    }
    for (const name of readdirSync(baseDir)) {
      const rel = `${base}/${name}`;
      if (existsSync(join(root, rel, 'package.json'))) dirs.add(rel);
    }
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

function lockfileImporters() {
  const text = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const documents = text.split(/^---$/m);
  let best = [];
  for (const doc of documents) {
    const lines = doc.split('\n');
    const start = lines.indexOf('importers:');
    if (start < 0) continue;
    const keys = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^[a-zA-Z]/.test(line)) break;
      const match = /^ {2}(\S.*):$/.exec(line);
      if (match) keys.push(match[1]);
    }
    if (keys.length > best.length) best = keys;
  }
  return new Set(best.filter((key) => key !== '.'));
}

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.json',
  '.md',
  '.yaml',
  '.yml',
]);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-web', '.turbo', 'coverage', 'build']);

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(join(root, dir))) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const rel = join(dir, entry);
    const stats = statSync(join(root, rel));
    if (stats.isDirectory()) collectFiles(rel, out);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) out.push(rel);
  }
  return out;
}

function usesDependency(corpus, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`["'\`]${escaped}(["'\`/]|$)`).test(corpus);
}

const dirs = workspaceDirs();
const manifests = dirs.map((dir) => {
  const json = readJson(join(root, dir, 'package.json'));
  if (typeof json.name !== 'string') fail(`${dir}/package.json has no name`);
  return { dir, json, name: json.name };
});
const byName = new Map(manifests.map((manifest) => [manifest.name, manifest.dir]));

const importers = lockfileImporters();
for (const { dir, json } of manifests) {
  const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap((field) => Object.keys(json[field] ?? {}));
  if (declared.length > 0 && !importers.has(dir)) {
    fail(
      `${dir}: ${declared.length} declared dependencies but no pnpm-lock.yaml importer — ` +
        '--frozen-lockfile cannot install this package',
    );
  }
}

let unusedCount = 0;
for (const { dir, json } of manifests) {
  const corpus = collectFiles(dir)
    .map((file) => readFileSync(join(root, file), 'utf8'))
    .join('\n');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dep, spec] of Object.entries(json[field] ?? {})) {
      if (!byName.has(dep)) continue;
      if (!String(spec).startsWith('workspace:')) {
        fail(`${dir}: ${field}.${dep} is a workspace package but declares "${spec}" instead of workspace:*`);
      }
      if (field === 'peerDependencies') continue;
      if (!usesDependency(corpus, dep)) {
        unusedCount += 1;
        fail(`${dir}: ${field}.${dep} is declared but no file in the package imports it`);
      }
    }
  }
}

const specifiers = new Map();
for (const { dir, json } of manifests) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [dep, spec] of Object.entries(json[field] ?? {})) {
      if (byName.has(dep) || dep.startsWith('@types/')) continue;
      if (!specifiers.has(dep)) specifiers.set(dep, new Map());
      const seen = specifiers.get(dep);
      if (!seen.has(spec)) seen.set(spec, []);
      seen.get(spec).push(dir);
    }
  }
}

const allowlist = existsSync(allowlistPath) ? readJson(allowlistPath) : {};
const allowlisted = new Set();
let divergenceCount = 0;
for (const [dep, seen] of [...specifiers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (seen.size < 2) continue;
  divergenceCount += 1;
  const summary = [...seen.entries()].map(([spec, owners]) => `${spec} (${owners.length})`).join(' | ');
  const reason = allowlist[dep];
  if (typeof reason === 'string' && reason.trim() !== '') {
    allowlisted.add(dep);
    notes.push(`${dep}: ${summary} — ${reason}`);
    continue;
  }
  fail(
    `${dep} is declared with ${seen.size} different specifiers: ${summary}. ` +
      'Use one specifier, or add the name to scripts/deps-consistency-allowlist.json with a reason',
  );
}

for (const dep of Object.keys(allowlist)) {
  if (!allowlisted.has(dep)) {
    fail(
      `scripts/deps-consistency-allowlist.json lists ${dep}, but it no longer diverges — ` +
        'remove the stale exception',
    );
  }
}

const relativeScript = relative(process.cwd(), import.meta.filename) || import.meta.filename;
if (violations.length > 0) {
  process.stderr.write(`dependency consistency check: FAIL (${violations.length})\n`);
  for (const violation of violations) process.stderr.write(`  ${violation}\n`);
  process.stderr.write(`\nRun \`node ${relativeScript.split(sep).join('/')}\` to re-check after the fix.\n`);
  process.exit(1);
}

process.stdout.write(
  `dependency consistency check: OK (${manifests.length} packages, ${importers.size} lockfile importers, ` +
    `${unusedCount} unused internal deps, ${divergenceCount} specifier divergences — ${allowlisted.size} allowlisted)\n`,
);
for (const note of notes) process.stdout.write(`  note: ${note}\n`);
