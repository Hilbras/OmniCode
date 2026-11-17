#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, 'packages');
const SCOPE = '@hilbras/omnicode-';

const LEAVES = new Set([
  'base',
  'auth',
  'kaos',
  'llm',
  'minidb',
  'telemetry',
  'transcript',
  'tree-sitter-bash',
  'tui',
]);

const FEATURES_INTEGRATION_DEPS = new Set(['engine', 'tools', 'addons', 'memory', 'base']);

// Every TypeScript source form, not just `.ts`: the walk used to skip `.tsx`, `.mts` and
// `.cts`, so an import written in any of those was never checked against these rules.
const TS_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

const RULES = [
  {
    name: 'leaf packages must not import other kernel packages',
    test: (from, to) => LEAVES.has(from) && to !== null,
    hint: 'leaves are the bottom of the graph; import nothing from Kernel',
  },
  {
    name: 'rpc may import base only',
    test: (from, to) => from === 'rpc' && to !== null && to !== 'base',
    hint: 'rpc is the transport layer above base; importing the engine would invert it',
  },
  {
    name: 'engine may import leaf packages only',
    test: (from, to) => from === 'engine' && to !== null && !LEAVES.has(to),
    hint: 'the engine is the top of the foundation; anything above it would invert the graph',
  },
  {
    name: 'core may import base and engine only',
    test: (from, to) => from === 'core' && to !== null && to !== 'base' && to !== 'engine',
    hint: 'core is now a re-export facade over base and engine',
  },
  {
    name: 'client-contract may import engine and rpc only',
    test: (from, to) =>
      from === 'client-contract' && to !== null && to !== 'engine' && to !== 'rpc',
    hint: 'the shared client contract sits beneath api and acp; importing either would close the cycle it exists to break',
  },
  {
    name: 'sdk must not import api',
    test: (from, to) => from === 'sdk' && to === 'api',
    hint: 'api re-exports sdk, so sdk depending on api is a cycle',
  },
  {
    name: 'acp must not import api',
    test: (from, to) => from === 'acp' && to === 'api',
    hint: 'api owns the acp loader, so the reverse edge closes a build cycle; acp consumes the shared client-contract package instead',
  },
  {
    name: 'features-integration may import engine, tools, addons, memory and base only',
    test: (from, to) =>
      from === 'features-integration' && to !== null && !FEATURES_INTEGRATION_DEPS.has(to),
    hint: 'this package exists so cross-package tests need not make engine depend on tools, addons or memory; it must not import api, acp or server',
  },
  {
    name: 'nothing may import server',
    test: (from, to) => to === 'server',
    hint: 'server sits on top of the graph',
  },
  {
    name: 'only api may import acp',
    test: (from, to) => to === 'acp' && from !== 'api',
    hint: 'acp is a host surface consumed through api',
  },
];

function packageDirs() {
  const out = new Map();
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const name = typeof pkg.name === 'string' ? pkg.name : '';
      if (!name.startsWith(SCOPE)) continue;
      out.set(name.slice(SCOPE.length), dir);
    } catch {
      continue;
    }
  }
  return out;
}

function walk(dir, files = []) {  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (TS_SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      files.push(full);
    }
  }
  return files;
}

const packages = packageDirs();
if (packages.size === 0) {
  console.error(`kernel layering: no packages found under ${relative(ROOT, PACKAGES_DIR) || PACKAGES_DIR}`);
  process.exit(1);
}
const KERNEL_PACKAGE = '@hilbras\\/omnicode-([a-z0-9-]+)(?:\\/[^\'"]*)?';
// Both quote styles, because a guard that only reads `'` is not a guard: importing
// `"@hilbras/omnicode-engine"` from a leaf kept this script green (proven on
// `packages/transcript`), and nothing in the repo forbids the double quote.
const QUOTED = `(['"])(?:${KERNEL_PACKAGE})\\1`;
const STATIC_FORMS = [
  new RegExp(`(?:import|export)\\s+[^;]*?from\\s+${QUOTED}`, 'g'),
  new RegExp(`import\\s+${QUOTED}`, 'g'),
];
const DYNAMIC_FORMS = [new RegExp(`import\\(\\s*${QUOTED}\\s*\\)`, 'g')];

function kernelImportsOf(text) {
  const found = new Map();
  // `QUOTED` puts the quote in group 1 and the package in group 2.
  for (const pattern of STATIC_FORMS) {
    for (const match of text.matchAll(pattern)) {
      if (match[2] !== undefined) found.set(match[2], false);
    }
  }
  for (const pattern of DYNAMIC_FORMS) {
    for (const match of text.matchAll(pattern)) {
      if (match[2] !== undefined && !found.has(match[2])) found.set(match[2], true);
    }
  }
  return found;
}

const violations = [];
const edges = new Map();

for (const [from, dir] of packages) {
  const deps = new Set();
  for (const file of walk(join(dir, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const [to, dynamic] of kernelImportsOf(text)) {
      if (to === from || !packages.has(to)) continue;
      if (!dynamic) deps.add(to);
      for (const rule of RULES) {
        if (rule.test(from, to)) {
          violations.push({
            rule: rule.name,
            hint: rule.hint,
            where: `${relative(ROOT, file)} -> ${SCOPE}${to}`,
          });
        }
      }
    }
  }
  edges.set(from, deps);
}

function findCycles(graph) {
  const found = [];
  const seen = new Set();
  const visit = (node, stack) => {
    if (stack.includes(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node);
      const key = [...new Set(cycle)].toSorted((left, right) => left.localeCompare(right)).join('>');
      if (!seen.has(key)) {
        seen.add(key);
        found.push(cycle);
      }
      return;
    }
    if (stack.length > 8) return;
    for (const next of graph.get(node) ?? []) visit(next, stack.concat(node));
  };
  for (const node of graph.keys()) visit(node, []);
  return found;
}

for (const cycle of findCycles(edges)) {
  violations.push({
    rule: 'no import cycles between kernel packages',
    hint: 'break the cycle or route through api',
    where: cycle.join(' -> '),
  });
}

if (violations.length > 0) {
  console.error(`kernel layering: ${String(violations.length)} violation(s)`);
  for (const violation of violations) {
    console.error(`  ${violation.rule}`);
    console.error(`    ${violation.where}`);
    console.error(`    ${violation.hint}`);
  }
  process.exit(1);
}

console.log(`kernel layering: OK (${String(packages.size)} packages, no cycles)`);
