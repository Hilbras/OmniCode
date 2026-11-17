#!/usr/bin/env node
// Fail on any type-aware oxlint finding that is not in the shrink-only
// baseline (scripts/oxlint-baseline.json). A fix that removes baseline entries
// also fails here, with instructions to regenerate, so the ledger can only
// shrink.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const baselinePath = new URL('./oxlint-baseline.json', import.meta.url);
if (!existsSync(baselinePath)) {
  console.error('oxlint baseline check: FAILED — scripts/oxlint-baseline.json is missing');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const stored = new Set(baseline.findings);

// An override or ignore pattern that names a directory nobody has is an exemption
// nobody can see: it silences nothing today, and it silently starts applying the
// moment someone creates that path. `.oxlintrc.json` named `packages/omnicode-minidb`,
// `packages/omnicode-server`, and `packages/omnicode-llm` — the directories are
// `minidb`, `server`, and `llm` — so three rule relaxations were dead.
const configPath = new URL('../.oxlintrc.json', import.meta.url);
const unanchored = readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, '');
const config = JSON.parse(unanchored);
const deadPaths = [];
for (const override of config.overrides ?? []) {
  for (const glob of override.files ?? []) {
    const anchor = glob.replace(/\/?\*\*.*$/, '').replace(/\/\*$/, '');
    if (anchor === '' || anchor.includes('*')) continue;
    if (!existsSync(new URL(`../${anchor}`, import.meta.url))) {
      deadPaths.push(`override files: ${glob} (no ${anchor} in the tree)`);
    }
  }
}
if (deadPaths.length > 0) {
  console.error('oxlint baseline check: FAILED — the lint config exempts paths that do not exist');
  for (const entry of deadPaths) console.error(`- ${entry}`);
  process.exit(1);
}

let report;
try {
  report = execFileSync('npx', ['oxlint', '--type-aware', '--quiet', '--format=json'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  report = error.stdout;
}
if (typeof report !== 'string' || report.length === 0) {
  console.error('oxlint produced no report');
  process.exit(1);
}
const parsed = JSON.parse(report);
if (!Array.isArray(parsed.diagnostics)) {
  console.error('unexpected oxlint JSON shape');
  process.exit(1);
}
const findings = parsed.diagnostics
  .filter((diag) => diag.severity === 'error' && typeof diag.code === 'string' && typeof diag.filename === 'string')
  .map((diag) => `${diag.code} ${diag.filename.replace(/\\/g, '/')}`);

const current = new Set(findings);

const unexpected = [...current].filter((finding) => !stored.has(finding));
const stale = [...stored].filter((finding) => !current.has(finding));

if (unexpected.length > 0 || stale.length > 0) {
  console.error('oxlint baseline check: FAILED');
  for (const finding of unexpected) console.error(`- NEW violation (fix it): ${finding}`);
  if (stale.length > 0) {
    console.error(`- ${stale.length} baseline entries are now fixed — shrink the ledger:`);
    console.error('  node scripts/gen-oxlint-baseline.mjs');
    for (const finding of stale.slice(0, 10)) console.error(`  fixed: ${finding}`);
  }
  process.exit(1);
}
console.log(`oxlint baseline check: OK (${current.size} frozen findings, 0 new)`);
