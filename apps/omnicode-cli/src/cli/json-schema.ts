import { readFile } from 'node:fs/promises';

import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';

export type JsonSchemaValidation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through to a fenced block.
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown;
    } catch {
      // Fall through to the error below.
    }
  }
  throw new Error('the final answer is not valid JSON');
}

export async function loadJsonSchema(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`JSON schema at ${path} must be an object.`);
  }
  return parsed as Record<string, unknown>;
}

export function validateJsonOutput(
  schema: Record<string, unknown>,
  text: string,
): JsonSchemaValidation {
  let value: unknown;
  try {
    value = parseJson(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const schemaId = typeof schema['$schema'] === 'string' ? schema['$schema'] : '';
  const uses2020 = schemaId.includes('2020-12');
  const ajv = uses2020
    ? new Ajv2020({ allErrors: true, strict: false })
    : new Ajv({ allErrors: true, strict: false });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    return {
      ok: false,
      error: `invalid schema: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
  if (validate(value)) return { ok: true, value };
  return { ok: false, error: ajv.errorsText(validate.errors, { separator: '; ' }) };
}
