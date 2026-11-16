/**
 * Emits the client-boundary wire contract as JSON Schema.
 *
 * The single source is the zod contract table in
 * `packages/client-contract/src/contract/` — the
 * procedure contracts (positional input tuple plus the resolved output, or the
 * yielded chunk for a streaming procedure) and the three event registration
 * tables. This script renders them into `docs/wire-contract.json` so a client
 * generator, a conformance tool, or a reviewer can read the whole boundary in
 * one diffable artifact, and `--check` fails when the artifact and the source
 * disagree.
 *
 * A `null` schema means the contract has no JSON Schema representation: the
 * procedure resolves with no value (`z.void()` / `z.undefined()` results, which
 * JSON Schema cannot express) or zod refused the schema.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { agentEvents } from '@hilbras/omnicode-client-contract/contract/agent/events.js';
import { globalEvents } from '@hilbras/omnicode-client-contract/contract/global/events.js';
import { globalContract } from '@hilbras/omnicode-client-contract/contract/index.js';
import { sessionEvents } from '@hilbras/omnicode-client-contract/contract/session/events.js';
import { isStreamingContract } from '@hilbras/omnicode-client-contract/contract/types.js';

const PKG = join(import.meta.dirname, '..');
export const MANIFEST_PATH = join(PKG, 'docs', 'wire-contract.json');

function log(message: string): void {
  console.log(`[gen-wire-contract] ${message}`);
}

function sortedEntries<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function jsonSchemaOf(schema: z.ZodType | undefined): unknown {
  if (schema === undefined) return null;
  try {
    return z.toJSONSchema(schema as never);
  } catch {
    return null;
  }
}

function renderProcedures(): Record<string, unknown> {
  const procedures: Record<string, unknown> = {};
  for (const [service, methods] of sortedEntries(globalContract)) {
    const entry: Record<string, unknown> = {};
    for (const [method, procedure] of sortedEntries(methods)) {
      if (isStreamingContract(procedure)) {
        entry[method] = {
          kind: 'streaming',
          input: jsonSchemaOf(procedure.input),
          chunk: jsonSchemaOf(procedure.chunk),
        };
        continue;
      }
      entry[method] = {
        kind: 'unary',
        input: jsonSchemaOf(procedure.input),
        output: jsonSchemaOf(procedure.output),
      };
    }
    procedures[service] = entry;
  }
  return procedures;
}

interface RegistrationLike {
  readonly kind?: unknown;
  readonly type?: unknown;
  readonly name?: unknown;
  readonly service?: unknown;
  readonly event?: unknown;
  readonly schema?: unknown;
}

function renderEvents(): Record<string, unknown> {
  const scopes: [string, Record<string, RegistrationLike>][] = [
    ['global', globalEvents as Record<string, RegistrationLike>],
    ['session', sessionEvents as Record<string, RegistrationLike>],
    ['agent', agentEvents as Record<string, RegistrationLike>],
  ];
  const events: Record<string, unknown> = {};
  for (const [scope, table] of scopes) {
    const entry: Record<string, unknown> = {};
    for (const [name, registration] of sortedEntries(table)) {
      const rendered: Record<string, unknown> = {
        kind: registration.kind,
        schema: jsonSchemaOf(registration.schema as z.ZodType | undefined),
      };
      if (registration.type !== undefined) rendered['type'] = registration.type;
      if (registration.name !== undefined) rendered['name'] = registration.name;
      if (registration.service !== undefined) rendered['service'] = registration.service;
      if (registration.event !== undefined) rendered['event'] = registration.event;
      entry[name] = rendered;
    }
    events[scope] = entry;
  }
  return events;
}

export function renderWireContract(): string {
  return `${JSON.stringify({ procedures: renderProcedures(), events: renderEvents() }, null, 2)}\n`;
}

function flatten(contract: Record<string, unknown>): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [section, entries] of sortedEntries(contract)) {
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [name, value] of sortedEntries(entries as Record<string, unknown>)) {
      flat.set(`${section}.${name}`, JSON.stringify(value));
    }
  }
  return flat;
}

function reportDrift(current: string, next: string): void {
  let before: Record<string, unknown> = {};
  let after: Record<string, unknown> = {};
  try {
    before = JSON.parse(current) as Record<string, unknown>;
  } catch {
    log(`${relative(PKG, MANIFEST_PATH)} is not readable JSON; regenerate it`);
    return;
  }
  after = JSON.parse(next) as Record<string, unknown>;
  for (const section of ['procedures', 'events']) {
    const beforeFlat = flatten({ [section]: before[section] ?? {} });
    const afterFlat = flatten({ [section]: after[section] ?? {} });
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const [key, value] of afterFlat) {
      const previous = beforeFlat.get(key);
      if (previous === undefined) added.push(key);
      else if (previous !== value) changed.push(key);
    }
    for (const key of beforeFlat.keys()) if (!afterFlat.has(key)) removed.push(key);
    if (changed.length + added.length + removed.length === 0) continue;
    log(
      `${section}: ${String(changed.length)} changed, ${String(added.length)} added, ${String(removed.length)} removed`,
    );
    for (const key of [...changed, ...added].slice(0, 12)) log(`  changed: ${key}`);
    for (const key of removed.slice(0, 12)) log(`  removed: ${key}`);
  }
}

function main(): void {
  const check = process.argv.includes('--check');
  const rendered = renderWireContract();
  if (check) {
    let current = '';
    try {
      current = readFileSync(MANIFEST_PATH, 'utf-8');
    } catch {
      current = '';
    }
    if (current === rendered) {
      log(`client wire contract is fresh (${relative(PKG, MANIFEST_PATH)})`);
      return;
    }
    if (current === '') {
      log(`${relative(PKG, MANIFEST_PATH)} is missing; regenerate to record the contract`);
    } else {
      log('client wire contract drifted from the contract source:');
      reportDrift(current, rendered);
    }
    process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, rendered);
  const parsed = JSON.parse(rendered) as {
    procedures: Record<string, Record<string, unknown>>;
    events: Record<string, Record<string, unknown>>;
  };
  const procedures = Object.values(parsed.procedures).reduce(
    (total, methods) => total + Object.keys(methods).length,
    0,
  );
  const events = Object.values(parsed.events).reduce(
    (total, scope) => total + Object.keys(scope).length,
    0,
  );
  const unrepresentable = Object.values(parsed.procedures).reduce(
    (total, methods) =>
      total +
      Object.values(methods).filter((method) =>
        ['input', 'output', 'chunk'].some(
          (key) => (method as Record<string, unknown>)[key] === null,
        ),
      ).length,
    0,
  );
  log(
    `wrote ${String(procedures)} procedure(s) and ${String(events)} event(s) -> ${relative(PKG, MANIFEST_PATH)}`,
  );
  if (unrepresentable > 0) {
    log(
      `note: ${String(unrepresentable)} procedure(s) carry a null schema (they resolve with no value)`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
