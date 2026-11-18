import { z } from 'zod';

import { parseBooleanEnv } from '@hilbras/omnicode-base/utils/env';
import {
  type ConfigSchema,
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
} from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

import { DEFAULT_MAX_REVIEWS, DEFAULT_REVIEWER_TIMEOUT_MS } from './reviewerLane';
import { DEFAULT_REVIEWER_PROMPT_CHARS } from './reviewerPrompt';
import { MAX_REVIEWER_SAMPLES } from './reviewerSampling';

export const REVIEWER_SECTION = 'reviewer';

export const REVIEWER_ENABLED_ENV = 'OMNICODE_REVIEWER';
export const REVIEWER_MODEL_ENV = 'OMNICODE_REVIEWER_MODEL';
export const REVIEWER_TIMEOUT_MS_ENV = 'OMNICODE_REVIEWER_TIMEOUT_MS';
export const REVIEWER_SAMPLES_ENV = 'OMNICODE_REVIEWER_SAMPLES';
export const REVIEWER_MAX_PROMPT_CHARS_ENV = 'OMNICODE_REVIEWER_MAX_PROMPT_CHARS';
export const REVIEWER_MAX_OUTPUT_TOKENS_ENV = 'OMNICODE_REVIEWER_MAX_OUTPUT_TOKENS';

/**
 * Operator configuration for the automated reviewer.
 *
 * Disabled by default. Enabling it is a named trade: in `manual` mode a
 * reviewer approval replaces the user's prompt for local file reads and writes,
 * so the operator is choosing to trust the reviewer with exactly that surface —
 * not with shell, network, credential, or operator-configured asks, which stay
 * human regardless of this section.
 */
export interface ReviewerSectionConfig {
  readonly enabled?: boolean;
  /** Model alias for the reviewer; omitted uses the agent's primary model. */
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly samples?: number;
  readonly maxPromptChars?: number;
  readonly maxOutputTokens?: number;
  /** Let the reviewer adjudicate auto-mode asks for in-scope local surfaces. */
  readonly autoMode?: boolean;
}

export interface ResolvedReviewerConfig {
  readonly enabled: boolean;
  readonly model: string | undefined;
  readonly timeoutMs: number;
  readonly samples: number;
  readonly maxPromptChars: number;
  readonly maxOutputTokens: number;
  readonly autoMode: boolean;
}

export const DEFAULT_REVIEWER_MAX_OUTPUT_TOKENS = 512;

export const ReviewerSectionSchema: ConfigSchema<ReviewerSectionConfig> = z
  .object({
    enabled: z.boolean().optional(),
    model: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1).optional(),
    samples: z.number().int().min(1).max(MAX_REVIEWER_SAMPLES).optional(),
    maxPromptChars: z.number().int().min(1).optional(),
    maxOutputTokens: z.number().int().min(1).optional(),
    autoMode: z.boolean().optional(),
  })
  .strict();

export const DEFAULT_REVIEWER_CONFIG: ResolvedReviewerConfig = {
  enabled: false,
  model: undefined,
  timeoutMs: DEFAULT_REVIEWER_TIMEOUT_MS,
  samples: 1,
  maxPromptChars: DEFAULT_REVIEWER_PROMPT_CHARS,
  maxOutputTokens: DEFAULT_REVIEWER_MAX_OUTPUT_TOKENS,
  autoMode: false,
};

export function resolveReviewerConfig(
  config: ReviewerSectionConfig | undefined,
): ResolvedReviewerConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_REVIEWER_CONFIG.enabled,
    model: config?.model ?? DEFAULT_REVIEWER_CONFIG.model,
    timeoutMs: config?.timeoutMs ?? DEFAULT_REVIEWER_CONFIG.timeoutMs,
    samples: config?.samples ?? DEFAULT_REVIEWER_CONFIG.samples,
    maxPromptChars: config?.maxPromptChars ?? DEFAULT_REVIEWER_CONFIG.maxPromptChars,
    maxOutputTokens: config?.maxOutputTokens ?? DEFAULT_REVIEWER_CONFIG.maxOutputTokens,
    autoMode: config?.autoMode ?? DEFAULT_REVIEWER_CONFIG.autoMode,
  };
}

function parsePositiveInt(raw: string): number | undefined {
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonBlankString(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const reviewerEnvBindings: EnvBindings<ReviewerSectionConfig> = envBindings(
  ReviewerSectionSchema,
  {
    enabled: { env: REVIEWER_ENABLED_ENV, parse: parseBooleanEnv },
    model: { env: REVIEWER_MODEL_ENV, parse: parseNonBlankString },
    timeoutMs: { env: REVIEWER_TIMEOUT_MS_ENV, parse: parsePositiveInt },
    samples: { env: REVIEWER_SAMPLES_ENV, parse: parsePositiveInt },
    maxPromptChars: { env: REVIEWER_MAX_PROMPT_CHARS_ENV, parse: parsePositiveInt },
    maxOutputTokens: { env: REVIEWER_MAX_OUTPUT_TOKENS_ENV, parse: parsePositiveInt },
  },
);

export const stripReviewerEnv = stripEnvBoundFields(reviewerEnvBindings);

registerConfigSection(REVIEWER_SECTION, ReviewerSectionSchema, {
  defaultValue: DEFAULT_REVIEWER_CONFIG,
  env: reviewerEnvBindings,
  stripEnv: stripReviewerEnv,
});