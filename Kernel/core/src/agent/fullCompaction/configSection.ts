import { z } from 'zod';

import { parseBooleanEnv } from '#/_base/utils/env';
import {
  type ConfigSchema,
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
} from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

export const COMPACTION_SECTION = 'compaction';

export const COMPACTION_AUTO_ENV = 'OMNICODE_COMPACTION_AUTO';
export const COMPACTION_MODEL_ENV = 'OMNICODE_COMPACTION_MODEL';
export const COMPACTION_KEEP_TOKENS_ENV = 'OMNICODE_COMPACTION_KEEP_TOKENS';
export const COMPACTION_TOOL_OUTPUT_MAX_CHARS_ENV = 'OMNICODE_COMPACTION_TOOL_OUTPUT_MAX_CHARS';

export interface CompactionSectionConfig {
  readonly auto?: boolean;
  readonly model?: string;
  readonly keepTokens?: number;
  readonly toolOutputMaxChars?: number;
}

export interface ResolvedCompactionConfig {
  readonly auto: boolean;
  readonly model: string | undefined;
  readonly keepTokens: number;
  readonly toolOutputMaxChars: number;
}

export const CompactionSectionSchema: ConfigSchema<CompactionSectionConfig> = z.object({
  auto: z.boolean().optional(),
  model: z.string().optional(),
  keepTokens: z.number().int().min(1).optional(),
  toolOutputMaxChars: z.number().int().min(0).optional(),
});

export const DEFAULT_COMPACTION_SECTION_CONFIG: ResolvedCompactionConfig = {
  auto: true,
  model: undefined,
  keepTokens: 15000,
  toolOutputMaxChars: 1250,
};

export function resolveCompactionConfig(
  config: CompactionSectionConfig | undefined,
): ResolvedCompactionConfig {
  return {
    auto: config?.auto ?? DEFAULT_COMPACTION_SECTION_CONFIG.auto,
    model: config?.model ?? DEFAULT_COMPACTION_SECTION_CONFIG.model,
    keepTokens: config?.keepTokens ?? DEFAULT_COMPACTION_SECTION_CONFIG.keepTokens,
    toolOutputMaxChars:
      config?.toolOutputMaxChars ?? DEFAULT_COMPACTION_SECTION_CONFIG.toolOutputMaxChars,
  };
}

function parseNonBlankString(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(raw: string): number | undefined {
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInt(raw: string): number | undefined {
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export const compactionEnvBindings: EnvBindings<CompactionSectionConfig> = envBindings(
  CompactionSectionSchema,
  {
    auto: { env: COMPACTION_AUTO_ENV, parse: parseBooleanEnv },
    model: { env: COMPACTION_MODEL_ENV, parse: parseNonBlankString },
    keepTokens: { env: COMPACTION_KEEP_TOKENS_ENV, parse: parsePositiveInt },
    toolOutputMaxChars: {
      env: COMPACTION_TOOL_OUTPUT_MAX_CHARS_ENV,
      parse: parseNonNegativeInt,
    },
  },
);

export const stripCompactionEnv = stripEnvBoundFields(compactionEnvBindings);

registerConfigSection(COMPACTION_SECTION, CompactionSectionSchema, {
  defaultValue: DEFAULT_COMPACTION_SECTION_CONFIG,
  env: compactionEnvBindings,
  stripEnv: stripCompactionEnv,
});
