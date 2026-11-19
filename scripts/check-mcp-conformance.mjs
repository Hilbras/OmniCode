#!/usr/bin/env node
/**
 * MCP client conformance gate.
 *
 * Runs the pinned official suite (`@modelcontextprotocol/conformance`) against
 * the engine's real MCP client stack through the adapter at
 * `packages/engine/scripts/mcp-conformance-client.mts`, and enforces the
 * committed baseline (`scripts/mcp-conformance-baseline.json`):
 *
 * - every baseline-passing check must still pass;
 * - no check may fail that the baseline does not already record (with a
 *   reason) — known failures stay visible, never relabeled;
 * - a baseline failure that starts passing is reported as an improvement and
 *   the gate still exits 0 (the maintainer should shrink the baseline).
 *
 * The baseline is reviewed, not regenerated to conceal a regression.
 *
 * Like `check:audit`, this gate is NOT part of `check:guards`: the suite must
 * be installed (pnpm install resolves the pinned devDependency) and each
 * scenario spawns local servers, so a green run costs a minute. CI runs it in
 * the guards job.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SUITE = 'node_modules/@modelcontextprotocol/conformance/dist/index.js';
const SUITE_PACKAGE = 'node_modules/@modelcontextprotocol/conformance/package.json';
const ADAPTER = join(ROOT, 'packages/engine/scripts/mcp-conformance-client.mts');
const TSX = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const BASELINE_PATH = join(ROOT, 'scripts/mcp-conformance-baseline.json');
const OUT_ROOT = join(ROOT, '.tmp/mcp-conformance');

const CLIENT_TIMEOUT_MS = 20_000;
const SCENARIO_TIMEOUT_MS = 90_000;

function fail(message) {
  console.error(`mcp conformance check: ${message}`);
  process.exit(1);
}

if (!existsSync(SUITE)) {
  fail(
    `the pinned suite is not installed — run pnpm install ` +
      `(node_modules/@modelcontextprotocol/conformance is a root devDependency)`,
  );
}
if (!existsSync(ADAPTER)) fail(`adapter missing: ${ADAPTER}`);
if (!existsSync(TSX)) fail('tsx is not installed — run pnpm install');

const suiteVersion = JSON.parse(readFileSync(SUITE_PACKAGE, 'utf8')).version;
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
if (baseline.suiteVersion !== suiteVersion) {
  fail(
    `suite version drift: baseline pins ${baseline.suiteVersion}, installed is ${suiteVersion}. ` +
      'Re-run the full matrix, review the diff, and update the baseline deliberately.',
  );
}

rmSync(OUT_ROOT, { recursive: true, force: true });
mkdirSync(OUT_ROOT, { recursive: true });

const clientCommand = `node ${TSX} ${ADAPTER}`;
const newFailures = [];
const improvements = [];
const results = [];

for (const scenario of baseline.scenarios) {
  const outDir = join(OUT_ROOT, `${scenario.name.replace('/', '__')}__${scenario.specVersion}`);
  mkdirSync(outDir, { recursive: true });

  const args = [
    SUITE,
    'client',
    '--command',
    clientCommand,
    '--scenario',
    scenario.name,
    '--spec-version',
    scenario.specVersion,
    '--timeout',
    String(CLIENT_TIMEOUT_MS),
    '-o',
    outDir,
  ];
  const run = spawnSync('node', args, {
    cwd: ROOT,
    encoding: 'utf8',
    // A cell whose recorded state is "the run does not terminate" only needs
    // enough time to prove it still hangs; every other cell gets the full
    // outer bound.
    timeout: scenario.expectNoReport === true ? 45_000 : SCENARIO_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const checks = readChecks(outDir);
  if (checks === undefined) {
    if (scenario.expectNoReport === true) {
      results.push({ scenario: scenario.name, spec: scenario.specVersion, outcome: 'no-report (recorded)' });
      continue;
    }
    newFailures.push(
      `${scenario.name} [${scenario.specVersion}]: the suite produced no check report ` +
        `(exit ${String(run.status)}, timeout ${run.status === null ? 'yes' : 'no'})`,
    );
    results.push({ scenario: scenario.name, spec: scenario.specVersion, outcome: 'no-report' });
    continue;
  }
  if (scenario.expectNoReport === true) {
    improvements.push(
      `${scenario.name} [${scenario.specVersion}]: the run now completes (the recorded no-report state changed) — review the checks and update the baseline`,
    );
  }

  const observedPass = new Set(
    checks.filter((check) => check.status === 'SUCCESS').map((check) => check.id),
  );
  const observedFail = new Set(
    checks.filter((check) => check.status === 'FAILURE').map((check) => check.id),
  );

  for (const passId of scenario.pass) {
    if (!observedPass.has(passId)) {
      newFailures.push(
        `${scenario.name} [${scenario.specVersion}]: check "${passId}" was passing in the baseline ` +
          `and is not passing now (observed: ${observedPass.has(passId) ? 'pass' : observedFail.has(passId) ? 'FAIL' : 'missing'})`,
      );
    }
  }

  const baselineFailIds = new Set(scenario.fail.map((entry) => entry.id));
  for (const failId of observedFail) {
    if (!baselineFailIds.has(failId)) {
      newFailures.push(
        `${scenario.name} [${scenario.specVersion}]: NEW failing check "${failId}" — fix it or record it in the baseline with a reason`,
      );
    }
  }
  for (const entry of scenario.fail) {
    if (observedPass.has(entry.id)) {
      improvements.push(`${scenario.name} [${scenario.specVersion}]: "${entry.id}" now passes — shrink the baseline`);
    }
  }

  const passed = observedPass.size;
  const failed = observedFail.size;
  results.push({ scenario: scenario.name, spec: scenario.specVersion, outcome: `${passed} passed, ${failed} failed` });
}

console.log('MCP client conformance (official suite pinned at', baseline.suiteVersion + '):');
for (const entry of results) {
  console.log(`  ${entry.scenario} [${entry.spec}]: ${entry.outcome}`);
}
for (const improvement of improvements) {
  console.log(`  improvement: ${improvement}`);
}
if (newFailures.length > 0) {
  console.error('\nmcp conformance check: FAILED');
  for (const failure of newFailures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nmcp conformance check: OK (baseline holds; known failures stay recorded)');

/** Find the newest checks.json under a run directory (auth suites nest one level). */
function readChecks(outDir) {
  const found = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === 'checks.json') found.push(p);
    }
  }
  if (!existsSync(outDir)) return undefined;
  walk(outDir);
  if (found.length === 0) return undefined;
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const raw = JSON.parse(readFileSync(found[0], 'utf8'));
  return Array.isArray(raw) ? raw : undefined;
}
