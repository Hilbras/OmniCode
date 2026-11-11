#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const failures = [];

function expand(pattern) {
  if (!pattern.includes('*')) {
    return existsSync(join(ROOT, pattern)) ? [pattern] : [];
  }
  const parts = pattern.split('/');
  const star = parts.indexOf('*');
  if (star === -1 || star !== parts.length - 1) {
    const base = parts.slice(0, star).join('/');
    const suffix = parts.slice(star + 1).join('/');
    const dir = join(ROOT, base);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((entry) => (suffix.length === 0 ? `${base}/${entry}` : `${base}/${entry}/${suffix}`))
      .filter((value) => existsSync(join(ROOT, value)));
  }
  const base = parts.slice(0, star).join('/');
  const dir = join(ROOT, base);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((entry) => `${base}/${entry}`)
    .filter((value) => existsSync(join(ROOT, value)));
}

const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split('\n');
const patterns = [];
let inPackages = false;
for (const line of workspace) {
  if (/^packages:\s*$/.test(line)) {
    inPackages = true;
    continue;
  }
  if (inPackages && /^\S/.test(line)) {
    inPackages = false;
  }
  if (!inPackages) continue;
  const match = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/.exec(line);
  if (match?.[1] !== undefined) patterns.push(match[1]);
}

for (const pattern of patterns) {
  const matches = expand(pattern);
  if (matches.length === 0) {
    failures.push(`workspace pattern resolved to zero paths: ${pattern}`);
    continue;
  }
  const packages = matches.filter((entry) => existsSync(join(ROOT, entry, 'package.json')));
  if (packages.length === 0) {
    failures.push(`workspace pattern resolved to zero packages: ${pattern}`);
  }
}

const vitest = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
const projectsBlock = /projects:\s*\[([\s\S]*?)\]/.exec(vitest)?.[1] ?? '';
const projectEntries = [...projectsBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
if (projectEntries.length === 0) {
  failures.push('vitest.config.ts declares no projects');
}
for (const entry of projectEntries) {
  if (expand(entry).length === 0) {
    failures.push(`vitest project path resolved to zero paths: ${entry}`);
  }
}

const textFiles = [];
for (const pattern of patterns) {
  for (const base of expand(pattern)) {
    const src = join(ROOT, base, 'src');
    if (!existsSync(src)) continue;
    const stack = [src];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(ts|tsx|mts)$/.test(entry.name)) textFiles.push(full);
      }
    }
  }
}
if (textFiles.length === 0) {
  failures.push('workspace src globs resolved to zero TypeScript testable files');
}

if (failures.length > 0) {
  console.error('workspace glob check: failed');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `workspace glob check: OK (${String(patterns.length)} patterns, ${String(projectEntries.length)} vitest projects, ${String(textFiles.length)} source files)`,
);
