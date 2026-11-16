#!/usr/bin/env node
// Fails when a test file in this workspace cannot be run by anything.
//
// Two ways a suite dies silently here, both of which happened:
//   1. a package carries a `test/` directory and no `vitest.config.ts`, so the root
//      project glob skips it (862 tests in three `app-*` packages);
//   2. a package has a `vitest.config.ts` and no `test` script, and because `pnpm
//      test` is `turbo run test` — not a root `vitest run`, which nothing invokes —
//      the suite never executes (955 tests in `SDK`, `auth`, `Kaos`).
// `check-workspace-globs.mjs` checks the forward direction (every *declared* project
// resolves). This checks that each test file has a runner *and* is matched by that
// runner's config.
import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.cwd();

// Runners that are not a package `test` script, and where they are configured.
const NON_PACKAGE_RUNNERS = [
  { prefix: '.agents/skills/', reason: 'runs through the root `check:skills` script' },
];

// Files known to execute nowhere, each with the reason measured at the time. Enforce
// shrink-only: an entry that matches nothing fails the guard, so fixing one of these
// cannot leave a stale exception behind (same idea as `scripts/oxlint-baseline.json`).
const KNOWN_UNWIRED = [
];

const TEST_GLOBS = [
  'packages/*/test/**/*.test.{ts,tsx,mts,cts,mjs,cjs}',
  'packages/*/src/**/*.test.{ts,tsx}',
  'apps/*/test/**/*.test.{ts,tsx,mjs,cjs}',
  'apps/*/*/test/**/*.test.{ts,tsx}',
  '.agents/skills/**/*.test.cjs',
];

const CONFIG_NAMES = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `vitest.config.${ext}`);

// Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, but Node's glob has
// no extglob support, so the same set is spelled out.
const DEFAULT_INCLUDE = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.mts',
  '**/*.test.cts',
  '**/*.test.mjs',
  '**/*.test.cjs',
  '**/*.spec.ts',
  '**/*.spec.tsx',
];

// Workspace packages come from the globs in `pnpm-workspace.yaml`, not from the
// nearest `package.json`: `packages/engine/src/human/package.json` is a nested helper
// manifest with an `imports` map, and its presence must not make that directory look
// like the owner of those tests (engine's own `test` script runs them).
function workspacePackageDirs() {
  const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [...workspace.matchAll(/^\s+-\s+"([^"]+)"/gm)].map((match) => match[1]);
  const dirs = [];
  for (const glob of globs) {
    if (glob === 'catalog') continue;
    for (const hit of globSync(`${glob}/package.json`, { cwd: ROOT })) dirs.push(dirname(hit));
  }
  return dirs.filter((dir) => dir !== '.');
}

const PACKAGE_DIRS = workspacePackageDirs();

function owningPackageDir(file) {
  const matches = PACKAGE_DIRS.filter((dir) => file.startsWith(`${dir}/`));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

function packageScripts(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    return manifest.scripts ?? {};
  } catch {
    return {};
  }
}

function findConfig(dir) {
  for (const name of CONFIG_NAMES) {
    if (existsSync(join(ROOT, dir, name))) return `${dir}/${name}`;
  }
  return null;
}

function includePatterns(configPath) {
  const text = readFileSync(join(ROOT, configPath), 'utf8');
  const patterns = [...text.matchAll(/include:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...match[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((quote) => quote[1] ?? quote[2]),
  );
  return patterns.length > 0 ? patterns : DEFAULT_INCLUDE;
}

// Which files each package's own runner would pick up.
const coveredByPackage = new Map();
for (const file of TEST_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: ROOT }))) {
  if (coveredByPackage.has(file)) continue;
  const pkgDir = owningPackageDir(file);
  if (pkgDir === null) {
    coveredByPackage.set(file, { reachable: false, why: 'no package.json above it' });
    continue;
  }
  const scripts = packageScripts(pkgDir);
  if (typeof scripts.test !== 'string' || scripts.test === '') {
    coveredByPackage.set(file, {
      reachable: false,
      why: `${pkgDir} has no \`test\` script, so a Turbo-driven \`pnpm test\` never runs it`,
    });
    continue;
  }
  const config = findConfig(pkgDir);
  if (config === null) {
    coveredByPackage.set(file, {
      reachable: false,
      why: `${pkgDir} has a \`test\` script but no vitest config for its runner to pick the file up`,
    });
    continue;
  }
  const rel = relative(pkgDir, file);
  const matched = includePatterns(config).some((pattern) =>
    globSync(pattern, { cwd: join(ROOT, pkgDir) }).includes(rel),
  );
  coveredByPackage.set(
    file,
    matched
      ? { reachable: true, why: `${pkgDir} (\`test\` script + ${config})` }
      : { reachable: false, why: `${config} does not match it (include: ${includePatterns(config).join(', ')})` },
  );
}

const failures = [];
const usedExceptions = new Set();
let wired = 0;

for (const [file, state] of [...coveredByPackage].sort(([left], [right]) =>
  left < right ? -1 : left > right ? 1 : 0,
)) {
  const runner = NON_PACKAGE_RUNNERS.find((entry) => file.startsWith(entry.prefix));
  if (runner !== undefined) {
    wired += 1;
    continue;
  }
  const exception = KNOWN_UNWIRED.find(
    (entry) => entry.file === file || (entry.prefix !== undefined && file.startsWith(entry.prefix)),
  );
  if (exception !== undefined) {
    usedExceptions.add(exception.file ?? exception.prefix);
    continue;
  }
  if (state.reachable) {
    wired += 1;
    continue;
  }
  failures.push(`${file} — ${state.why}`);
}

for (const exception of KNOWN_UNWIRED) {
  const key = exception.file ?? exception.prefix;
  if (!usedExceptions.has(key)) {
    failures.push(
      `stale exception in this guard: ${key} matches no test file (fixed, moved, or deleted) — remove it`,
    );
  }
}

for (const exception of KNOWN_UNWIRED) {
  console.log(`known unwired suite: ${exception.file ?? `${exception.prefix}*`}\n  why: ${exception.reason}`);
}
console.log(`test reachability: ${wired} test files run by a package script`);

if (failures.length > 0) {
  console.error('test reachability check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `test reachability check: OK (${wired} wired, ${KNOWN_UNWIRED.length} documented as unwired)`,
);
