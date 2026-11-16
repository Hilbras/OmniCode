/**
 * Renders the client-boundary wire contract as a Markdown reference.
 *
 * The machine-readable artifact is `docs/wire-contract.json` (see
 * `gen-wire-contract.mts`); this is the human-readable index over the same zod
 * contract tables, so a client author can see every service method and event
 * without reading JSON Schema. Full schemas are not inlined — each row carries a
 * short type summary and the JSON artifact carries the detail.
 *
 * `--check` renders in memory and compares, so `pnpm check:generated` fails when
 * the reference and the contract source disagree.
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
const REPO = join(PKG, '..', '..');
export const REFERENCE_PATH = join(PKG, 'docs', 'wire-contract.md');

function log(message: string): void {
  console.log(`[gen-api-reference] ${message}`);
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

/** One-line summary of a JSON Schema. Deliberately shallow. */
function summarize(schema: unknown): string {
  if (schema === null || schema === undefined) return 'no value';
  if (typeof schema !== 'object') return 'unknown';
  const node = schema as Record<string, unknown>;
  if (Array.isArray(node['enum'])) {
    return (node['enum'] as readonly unknown[]).map((value) => JSON.stringify(value)).join(' | ');
  }
  for (const combiner of ['anyOf', 'oneOf'] as const) {
    const branches = node[combiner];
    if (Array.isArray(branches)) {
      const parts = branches.map((branch) => summarize(branch));
      return [...new Set(parts)].join(' | ');
    }
  }
  const type = node['type'];
  if (type === 'object') {
    const properties = node['properties'];
    if (typeof properties === 'object' && properties !== null) {
      const keys = Object.keys(properties as Record<string, unknown>);
      const required = new Set(
        Array.isArray(node['required']) ? (node['required'] as readonly string[]) : [],
      );
      const shown = keys.slice(0, 6).map((key) => (required.has(key) ? key : `${key}?`));
      const suffix = keys.length > shown.length ? `, …${String(keys.length - shown.length)} more` : '';
      return `object{${shown.join(', ')}${suffix}}`;
    }
    return 'object';
  }
  if (type === 'array') {
    // zod renders a positional tuple as `prefixItems`: `()` is "no arguments".
    const prefixItems = node['prefixItems'];
    if (Array.isArray(prefixItems)) {
      if (prefixItems.length === 0) return '()';
      return `(${prefixItems.map((item) => summarize(item)).join(', ')})`;
    }
    if (node['maxItems'] === 0) return '[]';
    return `${summarize(node['items'])}[]`;
  }
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return (type as readonly string[]).join(' | ');
  return 'unknown';
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|');
}

interface RegistrationLike {
  readonly kind?: unknown;
  readonly type?: unknown;
  readonly name?: unknown;
  readonly service?: unknown;
  readonly event?: unknown;
  readonly schema?: unknown;
}

// These fields name a wire type or a service, so they are strings in practice. The
// registries type them as `unknown`, and interpolating an object would publish
// `[object Object]` into the reference — print scalars, and nothing for anything else.
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function renderEvents(): string[] {
  const scopes: [string, Record<string, RegistrationLike>][] = [
    ['global', globalEvents as Record<string, RegistrationLike>],
    ['session', sessionEvents as Record<string, RegistrationLike>],
    ['agent', agentEvents as Record<string, RegistrationLike>],
  ];
  const lines: string[] = ['## Events', ''];
  for (const [scope, table] of scopes) {
    lines.push(`### ${scope}`, '', '| event | kind | source | payload |', '| --- | --- | --- | --- |');
    for (const [name, registration] of sortedEntries(table)) {
      const source =
        registration.type !== undefined
          ? `type \`${scalarText(registration.type)}\``
          : registration.service !== undefined
            ? `service \`${scalarText(registration.service)}\``
            : registration.name !== undefined
              ? `name \`${scalarText(registration.name)}\``
              : 'whole stream';
      lines.push(
        `| \`${escapeCell(name)}\` | ${scalarText(registration.kind)} | ${escapeCell(source)} | ` +
          `${escapeCell(summarize(jsonSchemaOf(registration.schema as z.ZodType | undefined)))} |`,
      );
    }
    lines.push('');
  }
  return lines;
}

export function renderApiReference(): string {
  const lines: string[] = [
    '# Wire contract reference',
    '',
    'Every service method and event registered on the client boundary of',
    '`@hilbras/omnicode-api`. Generated from the zod contract tables in',
    '`packages/client-contract/src/contract/` by',
    '`pnpm --filter @hilbras/omnicode-api gen:api-reference` — do not edit by hand.',
    '',
    'The type summaries below are shallow on purpose; the full JSON Schema for each',
    'entry is in `packages/API/docs/wire-contract.json`. `no value` marks a',
    'procedure that resolves with nothing (`z.void()`), which JSON Schema cannot',
    'express.',
    '',
    '## Procedures',
    '',
  ];
  for (const [service, methods] of sortedEntries(globalContract)) {
    lines.push(`### ${service}`, '', '| method | kind | input | output |', '| --- | --- | --- | --- |');
    for (const [method, procedure] of sortedEntries(methods)) {
      if (isStreamingContract(procedure)) {
        lines.push(
          `| \`${escapeCell(method)}\` | streaming | ` +
            `${escapeCell(summarize(jsonSchemaOf(procedure.input)))} | ` +
            `${escapeCell(`chunk: ${summarize(jsonSchemaOf(procedure.chunk))}`)} |`,
        );
        continue;
      }
      lines.push(
        `| \`${escapeCell(method)}\` | unary | ` +
          `${escapeCell(summarize(jsonSchemaOf(procedure.input)))} | ` +
          `${escapeCell(summarize(jsonSchemaOf(procedure.output)))} |`,
      );
    }
    lines.push('');
  }
  lines.push(...renderEvents());
  return `${lines.join('\n').trimEnd()}\n`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const rendered = renderApiReference();
  if (check) {
    let current = '';
    try {
      current = readFileSync(REFERENCE_PATH, 'utf-8');
    } catch {
      current = '';
    }
    if (current === rendered) {
      log(`wire contract reference is fresh (${relative(REPO, REFERENCE_PATH)})`);
      return;
    }
    log(
      current === ''
        ? `${relative(REPO, REFERENCE_PATH)} is missing; regenerate it`
        : `${relative(REPO, REFERENCE_PATH)} drifted from the contract source`,
    );
    process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(REFERENCE_PATH), { recursive: true });
  writeFileSync(REFERENCE_PATH, rendered);
  log(`wrote ${relative(REPO, REFERENCE_PATH)} (${String(rendered.length)} bytes)`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
