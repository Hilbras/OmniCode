#!/usr/bin/env node
// Regenerate scripts/oxlint-baseline.json from the current type-aware oxlint
// output. The baseline freezes PRE-EXISTING type-aware findings so the lint
// gate can fail on new ones. The baseline may only shrink: fixing findings and
// regenerating removes entries, and the check script fails if the file ever
// grows relative to what the current run produces.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

const unique = new Set(findings);
const baseline = {
  comment: 'Pre-existing type-aware oxlint findings. Shrink-only: remove entries when fixed; never add. Regenerate with `node scripts/gen-oxlint-baseline.mjs`.',
  count: unique.size,
  findings: [...unique].sort(),
};
writeFileSync(new URL('./oxlint-baseline.json', import.meta.url), `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`oxlint baseline: ${baseline.count} findings`);
