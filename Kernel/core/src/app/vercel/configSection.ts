import { z } from 'zod';

import { type EnvBindings, envBindings, stripEnvBoundFields } from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

export const VERCEL_SECTION = 'vercel';

export const VercelSectionSchema = z.object({
  token: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  teamSlug: z.string().min(1).optional(),
});

export type VercelSection = z.infer<typeof VercelSectionSchema>;

export const VERCEL_TOKEN_ENV = 'OMNICODE_VERCEL_TOKEN';
export const VERCEL_TEAM_ID_ENV = 'OMNICODE_VERCEL_TEAM_ID';
export const VERCEL_TEAM_SLUG_ENV = 'OMNICODE_VERCEL_TEAM_SLUG';

export const vercelEnvBindings: EnvBindings<VercelSection> = envBindings(VercelSectionSchema, {
  token: { env: VERCEL_TOKEN_ENV },
  teamId: { env: VERCEL_TEAM_ID_ENV },
  teamSlug: { env: VERCEL_TEAM_SLUG_ENV },
});

export const stripVercelEnv = stripEnvBoundFields(vercelEnvBindings);

registerConfigSection(VERCEL_SECTION, VercelSectionSchema, {
  env: vercelEnvBindings,
  stripEnv: stripVercelEnv,
});
