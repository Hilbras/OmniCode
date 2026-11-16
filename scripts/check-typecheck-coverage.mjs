#!/usr/bin/env node
// Fails when a workspace package ships `src/` that no `typecheck` script covers.
//
// `pnpm typecheck` is `turbo run typecheck`, so it runs exactly the packages that
// declare the script and silently skips the rest. Nothing else type-checks a
// package either: the consumer apps run plain `tsc` (not `vue-tsc`) over their own
// `src`, which cannot check `.vue` sources, and the bundler that transpiles those
// sources does not type-check at all. So a package without the script can carry
// thousands of diagnostics no command reports — which is the state `app-client`,
// `app-composer`, and `app-components` were in.
//
// The exceptions below are decisions, not oversights: two of them are written into
// the package's own `AGENTS.md`. Each entry cites what was measured or decided, and
// the list is shrink-only — an entry that matches nothing fails the guard, so wiring
// a package cannot leave a stale exception behind.
import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();

const KNOWN_UNWIRED = [
];

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

const failures = [];
const used = new Set();
let wired = 0;

for (const dir of workspacePackageDirs().sort()) {
  if (!existsSync(join(ROOT, dir, 'src'))) continue;
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  const scripts = manifest.scripts ?? {};
  const exception = KNOWN_UNWIRED.find((entry) => entry.dir === dir);
  const hasTypecheck = typeof scripts.typecheck === 'string' && scripts.typecheck !== '';
  if (exception !== undefined) {
    if (hasTypecheck) {
      // An exception that has been wired is stale: shipping a `typecheck` script
      // while the ledger still excludes the package silently under-counts the
      // coverage this guard claims to measure.
      failures.push(
        `stale exception in this guard: ${dir} now declares a \`typecheck\` script — remove its entry`,
      );
      used.add(exception.dir);
      wired += 1;
      continue;
    }
    used.add(exception.dir);
    continue;
  }
  if (hasTypecheck) {
    wired += 1;
    continue;
  }
  failures.push(
    `${dir} (${manifest.name ?? 'unnamed'}) ships src/ with no \`typecheck\` script, so \`pnpm typecheck\` skips it and nothing else type-checks its sources`,
  );
}

for (const exception of KNOWN_UNWIRED) {
  if (!used.has(exception.dir)) {
    failures.push(
      `stale exception in this guard: ${exception.dir} no longer ships src/ or has been wired — remove it`,
    );
  }
  console.log(`known untypechecked package: ${exception.dir}\n  why: ${exception.reason}`);
}
console.log(`typecheck coverage: ${wired} packages run a typecheck script`);

if (failures.length > 0) {
  console.error('typecheck coverage check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `typecheck coverage check: OK (${wired} wired, ${KNOWN_UNWIRED.length} documented as untypechecked)`,
);
