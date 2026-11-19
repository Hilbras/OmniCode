#!/usr/bin/env node
/**
 * Safety ledger (WS6.5): pins the safety-critical constants introduced by the
 * advanced-strength program so a default cannot drift silently. This is the
 * shrink-only family alongside oxlint/conformance baselines: removing a pin
 * requires an explicit, reviewed ledger edit, not an incidental source change.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = import.meta.dirname.replace(/[\\/]scripts$/, '');
const LEDGER_PATH = join(REPO_ROOT, 'scripts', 'safety-ledger.json');

function readValue(text, pattern) {
  const match = new RegExp(pattern, 'm').exec(text);
  return match?.[1];
}

/** Pure ledger check against an in-memory file reader for fixtures. */
export function checkSafetyLedger(ledger, readFile) {
  const violations = [];

  for (const [id, pin] of Object.entries(ledger.pins)) {
    const text = readFile(pin.file);
    if (text === undefined) {
      violations.push({ id, file: pin.file, kind: 'missing-declaration', expected: pin.value });
      continue;
    }
    const actual = readValue(text, pin.pattern);
    if (actual !== pin.value) {
      violations.push({
        id, file: pin.file, kind: 'value-drift', expected: pin.value, actual,
      });
    }
  }

  return violations;
}

function main() {
  if (!existsSync(LEDGER_PATH)) {
    process.stderr.write('safety ledger check: FAILED — scripts/safety-ledger.json is missing\n');
    process.exit(1);
  }
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  const violations = checkSafetyLedger(ledger, (file) => {
    const path = join(REPO_ROOT, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  });
  if (violations.length > 0) {
    process.stderr.write(`safety ledger check: FAILED (${violations.length})\n`);
    for (const v of violations) {
      process.stderr.write(
        `  ${v.id}: ${v.kind} in ${v.file} — expected "${v.expected}", got "${String(v.actual)}"\n` +
          `    review scripts/safety-ledger.json before changing this pin\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write(
    `safety ledger check: OK (${Object.keys(ledger.pins).length} pins)\n`,
  );
}

if (process.argv[1] && import.meta.filename.endsWith(relative(REPO_ROOT, process.argv[1]).replace(/\\/g, '/'))) {
  main();
}
