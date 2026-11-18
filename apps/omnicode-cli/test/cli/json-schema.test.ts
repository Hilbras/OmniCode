import { describe, expect, it } from 'vitest';

import { validateJsonOutput } from '#/cli/json-schema';

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
} as const;

describe('--json-schema validation', () => {
  it('accepts a conforming object', () => {
    const result = validateJsonOutput(SCHEMA, '{"name":"Hassan"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Hassan' });
  });

  it('accepts a fenced JSON block', () => {
    expect(validateJsonOutput(SCHEMA, '```json\n{"name":"Hassan"}\n```').ok).toBe(true);
  });

  it('reports a schema violation', () => {
    const result = validateJsonOutput(SCHEMA, '{"name":42}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('name');
  });

  it('rejects missing required fields', () => {
    const result = validateJsonOutput(SCHEMA, '{}');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-JSON answer', () => {
    const result = validateJsonOutput(SCHEMA, 'Your name is Hassan.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('supports a draft 2020-12 schema', () => {
    const result = validateJsonOutput(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { count: { type: 'integer', minimum: 1 } },
        required: ['count'],
      },
      '{"count":2}',
    );
    expect(result.ok).toBe(true);
  });
});
