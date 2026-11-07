import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';
import { isPlainObject, plainObjectToToml, transformPlainObject } from '#/app/config/toml';

import { HOOK_EVENT_TYPES } from './internal/types';

export const HOOKS_SECTION = 'hooks';

const HOOK_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_HOOK_ENV_ENTRIES = 64;

export const HookDefSchema = z
  .object({
    event: z.enum(HOOK_EVENT_TYPES),
    matcher: z.string().optional(),
    command: z.string().min(1),
    timeout: z.number().int().min(1).max(600).optional(),
    cwd: z.string().optional(),
    env: z
      .record(
        z.string().regex(HOOK_ENV_KEY_PATTERN, {
          message: 'environment variable names must match [A-Za-z_][A-Za-z0-9_]*',
        }),
        z.string(),
      )
      .refine((value) => Object.keys(value).length <= MAX_HOOK_ENV_ENTRIES, {
        message: `at most ${MAX_HOOK_ENV_ENTRIES} environment variables per hook`,
      })
      .optional(),
  })
  .strict();

export type HookDefConfig = z.infer<typeof HookDefSchema>;

export const HooksConfigSchema = z.array(HookDefSchema);

export const hooksFromToml = (rawSnake: unknown): unknown => {
  if (!Array.isArray(rawSnake)) return rawSnake;
  return rawSnake.map((hook) => (isPlainObject(hook) ? transformPlainObject(hook) : hook));
};

export const hooksToToml = (value: unknown, _rawSnake: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return value.map((hook) => (isPlainObject(hook) ? plainObjectToToml(hook, undefined) : hook));
};

registerConfigSection(HOOKS_SECTION, HooksConfigSchema, {
  fromToml: hooksFromToml,
  toToml: hooksToToml,
});
