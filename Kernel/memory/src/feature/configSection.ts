import { z } from 'zod';

import { parseBooleanEnv, parseNumberEnv } from '@hilbras/omnicode-core/_base/utils/env';
import {
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
} from '@hilbras/omnicode-core/app/config/config';
import { registerConfigSection } from '@hilbras/omnicode-core/app/config/configSectionContributions';

export const MEMORY_SECTION = 'memory';

export const MEMORY_DIR_ENV = 'OMNICODE_MEMORY_DIR';
export const MEMORY_ENABLED_ENV = 'OMNICODE_MEMORY_ENABLED';
export const MEMORY_MAX_CONTENT_ENV = 'OMNICODE_MEMORY_MAX_CONTENT_CHARS';
export const MEMORY_WORKING_TTL_ENV = 'OMNICODE_MEMORY_WORKING_TTL_MS';
export const MEMORY_INJECT_CANONICAL_ENV = 'OMNICODE_MEMORY_INJECT_CANONICAL';

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  dir: z.string().min(1).optional(),
  maxContentChars: z.number().int().min(1).max(100_000).optional(),
  workingTtlMs: z.number().int().min(0).optional(),
  workingGraceMs: z.number().int().min(0).optional(),
  injectCanonical: z.boolean().optional(),
  reviewMaxAttempts: z.number().int().min(1).max(10).optional(),
  reviewBackoffMs: z.number().int().min(0).optional(),
  maxQueuedReviews: z.number().int().min(1).max(100_000).optional(),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const memoryEnvBindings: EnvBindings<MemoryConfig> = envBindings(MemoryConfigSchema, {
  enabled: { env: MEMORY_ENABLED_ENV, parse: parseBooleanEnv },
  dir: { env: MEMORY_DIR_ENV },
  maxContentChars: { env: MEMORY_MAX_CONTENT_ENV, parse: parseNumberEnv },
  workingTtlMs: { env: MEMORY_WORKING_TTL_ENV, parse: parseNumberEnv },
  injectCanonical: { env: MEMORY_INJECT_CANONICAL_ENV, parse: parseBooleanEnv },
});

export const stripMemoryEnv = stripEnvBoundFields(memoryEnvBindings);

registerConfigSection(MEMORY_SECTION, MemoryConfigSchema, {
  env: memoryEnvBindings,
  stripEnv: stripMemoryEnv,
});