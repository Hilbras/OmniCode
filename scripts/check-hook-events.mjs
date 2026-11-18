import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TYPES_PATH = 'packages/engine/src/features/externalHooks/internal/types.ts';
const EMITTER_ROOTS = ['packages/engine/src'];

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const types = readFileSync(TYPES_PATH, 'utf8');
const block = /HOOK_EVENT_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(types);
if (block === null) {
  console.error('hook event check: could not read HOOK_EVENT_TYPES');
  process.exit(1);
}
const events = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

const sources = EMITTER_ROOTS.flatMap((root) => walk(root)).filter((path) => path !== TYPES_PATH);
const text = sources.map((path) => readFileSync(path, 'utf8')).join('\n');
const missing = events.filter((event) => !text.includes(event));

if (events.length === 0) {
  console.error('hook event check: no events parsed');
  process.exit(1);
}
if (missing.length > 0) {
  console.error(`hook event check: events with no emitter: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`hook event check: OK (${String(events.length)} events, all emitted)`);
