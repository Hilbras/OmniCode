import { describe, expect, it } from 'vitest';

import {
  COMPACTION_AUTO_ENV,
  COMPACTION_KEEP_TOKENS_ENV,
  COMPACTION_MODEL_ENV,
  COMPACTION_TOOL_OUTPUT_MAX_CHARS_ENV,
  compactionEnvBindings,
  DEFAULT_COMPACTION_SECTION_CONFIG,
  resolveCompactionConfig,
} from '#/agent/fullCompaction/configSection';
import type { EnvBinding } from '#/app/config/config';

function bindingFor(field: string): EnvBinding {
  const binding = (compactionEnvBindings as Record<string, unknown>)[field];
  if (typeof binding === 'string' || !('env' in (binding as object))) {
    throw new Error(`Missing env binding for ${field}`);
  }
  return binding as EnvBinding;
}

function parseField(field: string, raw: string): unknown {
  const binding = bindingFor(field);
  if (typeof binding === 'string') return binding;
  return binding.parse?.(raw);
}

describe('compaction config section', () => {
  it('falls back to the defaults', () => {
    expect(resolveCompactionConfig(undefined)).toEqual(DEFAULT_COMPACTION_SECTION_CONFIG);
  });

  it('keeps the configured model', () => {
    expect(resolveCompactionConfig({ model: 'provider/model' }).model).toBe('provider/model');
  });

  it('overrides each field independently', () => {
    const resolved = resolveCompactionConfig({
      auto: false,
      keepTokens: 4_000,
      toolOutputMaxChars: 0,
    });
    expect(resolved.auto).toBe(false);
    expect(resolved.keepTokens).toBe(4_000);
    expect(resolved.toolOutputMaxChars).toBe(0);
    expect(resolved.model).toBeUndefined();
  });

  it('binds every field to its env variable', () => {
    expect(bindingFor('auto')).toMatchObject({ env: COMPACTION_AUTO_ENV });
    expect(bindingFor('model')).toMatchObject({ env: COMPACTION_MODEL_ENV });
    expect(bindingFor('keepTokens')).toMatchObject({ env: COMPACTION_KEEP_TOKENS_ENV });
    expect(bindingFor('toolOutputMaxChars')).toMatchObject({
      env: COMPACTION_TOOL_OUTPUT_MAX_CHARS_ENV,
    });
  });

  it('ignores blank and malformed env values', () => {
    expect(parseField('model', '   ')).toBeUndefined();
    expect(parseField('keepTokens', 'abc')).toBeUndefined();
    expect(parseField('keepTokens', '0')).toBeUndefined();
    expect(parseField('toolOutputMaxChars', '-1')).toBeUndefined();
  });

  it('accepts well formed env values', () => {
    expect(parseField('model', ' provider/model ')).toBe('provider/model');
    expect(parseField('keepTokens', ' 4000 ')).toBe(4_000);
    expect(parseField('toolOutputMaxChars', '0')).toBe(0);
  });
});
