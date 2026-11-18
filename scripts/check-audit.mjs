import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWLIST_PATH = 'scripts/audit-allowlist.json';

const audit = spawnSync('pnpm', ['audit', '--json'], { encoding: 'utf8' });
const stdout = (audit.stdout ?? '').trim();
if (stdout.length === 0) {
  console.error('audit check: pnpm audit produced no JSON; the registry may be unreachable.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(stdout);
} catch {
  console.error('audit check: pnpm audit output was not JSON.');
  process.exit(1);
}

const advisories = report.advisories ?? {};
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
const allowed = new Map(allowlist.map((entry) => [entry.module, entry]));
const blocking = Object.values(advisories).filter(
  (advisory) => advisory.severity === 'high' || advisory.severity === 'critical',
);

const seen = new Set();
const unexpected = [];
for (const advisory of blocking) {
  if (allowed.has(advisory.module_name)) seen.add(advisory.module_name);
  else unexpected.push(advisory);
}

const stale = [...allowed.keys()].filter((module) => !seen.has(module));
const counts = Object.values(advisories).reduce((accumulator, advisory) => {
  accumulator[advisory.severity] = (accumulator[advisory.severity] ?? 0) + 1;
  return accumulator;
}, {});

const summary = `audit: ${String(Object.keys(advisories).length)} advisories (${Object.entries(counts)
  .map(([severity, count]) => `${String(count)} ${severity}`)
  .join(', ')})`;

if (unexpected.length > 0) {
  console.error(`${summary} — ${String(unexpected.length)} high/critical not allowlisted`);
  for (const advisory of unexpected) {
    console.error(`- ${advisory.module_name}: ${advisory.title} (patched: ${advisory.patched_versions})`);
  }
  process.exit(1);
}

if (stale.length > 0) {
  console.error(`${summary} — allowlist entries no longer needed: ${stale.join(', ')}`);
  console.error('Remove them from scripts/audit-allowlist.json; the list is shrink-only.');
  process.exit(1);
}

console.log(`${summary} — build-time exceptions: ${[...allowed.keys()].join(', ')}`);
console.log('audit check: OK');
