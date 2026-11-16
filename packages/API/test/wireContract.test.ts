import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MANIFEST_PATH, renderWireContract } from '../scripts/gen-wire-contract.mts';

describe('client wire contract artifact', () => {
  it('docs/wire-contract.json matches the contract source', () => {
    expect(readFileSync(MANIFEST_PATH, 'utf-8')).toBe(renderWireContract());
  });

  it('covers every registered service method and event', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
      procedures: Record<string, Record<string, unknown>>;
      events: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(manifest.procedures).length).toBeGreaterThan(30);
    expect(Object.keys(manifest.events)).toEqual(['global', 'session', 'agent']);
    for (const [scope, table] of Object.entries(manifest.events)) {
      expect(Object.keys(table).length, `${scope} events`).toBeGreaterThan(0);
    }
    expect(Object.keys(manifest.events['agent'] ?? {}).length).toBeGreaterThan(10);
  });
});
