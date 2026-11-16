import { describe, expect, it } from 'vitest';

import { agentEvents } from '@hilbras/omnicode-client-contract/contract/agent/events.js';
import { globalEvents } from '@hilbras/omnicode-client-contract/contract/global/events.js';
import { sessionEvents } from '@hilbras/omnicode-client-contract/contract/session/events.js';
import { globalContract } from '@hilbras/omnicode-client-contract/contract/index.js';

interface RegistrationLike {
  readonly kind?: string;
  readonly type?: string;
  readonly schema?: unknown;
}

const SCOPES: [string, Record<string, RegistrationLike>][] = [
  ['global', globalEvents as Record<string, RegistrationLike>],
  ['session', sessionEvents as Record<string, RegistrationLike>],
  ['agent', agentEvents as Record<string, RegistrationLike>],
];

describe('client wire contract completeness', () => {
  it('gives every registered event a payload schema', () => {
    const schemaless: string[] = [];
    for (const [scope, table] of SCOPES) {
      for (const [name, registration] of Object.entries(table)) {
        if (registration.schema === undefined) schemaless.push(`${scope}.${name}`);
      }
    }
    expect(schemaless).toEqual([]);
  });

  it('gives every stream registration a source stream name', () => {
    const incomplete: string[] = [];
    for (const [scope, table] of SCOPES) {
      for (const [name, registration] of Object.entries(table)) {
        if (registration.kind !== 'stream') continue;
        if (registration.name === undefined) incomplete.push(`${scope}.${name}`);
      }
    }
    expect(incomplete).toEqual([]);
  });

  it('gives every procedure an input schema and an output or chunk schema', () => {
    const incomplete: string[] = [];
    for (const [service, methods] of Object.entries(globalContract)) {
      for (const [method, procedure] of Object.entries(methods)) {
        const keys = Object.keys(procedure);
        const complete =
          keys.includes('input') && (keys.includes('output') || keys.includes('chunk'));
        if (!complete) incomplete.push(`${service}.${method}`);
      }
    }
    expect(incomplete).toEqual([]);
  });
});
