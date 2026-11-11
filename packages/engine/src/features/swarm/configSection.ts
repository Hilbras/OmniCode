import { z } from 'zod';

import {
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
  type IConfigService,
} from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

export const SWARM_SECTION = 'swarm';

export const SwarmConfigSchema = z.object({
  timeoutMs: z.number().int().min(0).optional(),
  maxTurnsPerSwarm: z.number().int().min(1).optional(),
  maxTokensPerSwarm: z.number().int().min(1).optional(),
  maxTimeMsPerSwarm: z.number().int().min(1).optional(),
});

export type SwarmConfig = z.infer<typeof SwarmConfigSchema>;

export const DEFAULT_SWARM_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const SWARM_TIMEOUT_ENV = 'OMNICODE_SWARM_TIMEOUT_MS';
export const SWARM_MAX_TURNS_ENV = 'OMNICODE_SWARM_MAX_TURNS';
export const SWARM_MAX_TOKENS_ENV = 'OMNICODE_SWARM_MAX_TOKENS';
export const SWARM_MAX_TIME_MS_ENV = 'OMNICODE_SWARM_MAX_TIME_MS';

function parsePositiveIntEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function parseTimeoutMsEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export const swarmEnvBindings: EnvBindings<SwarmConfig> = envBindings(SwarmConfigSchema, {
  timeoutMs: { env: SWARM_TIMEOUT_ENV, parse: parseTimeoutMsEnv },
  maxTurnsPerSwarm: { env: SWARM_MAX_TURNS_ENV, parse: parsePositiveIntEnv },
  maxTokensPerSwarm: { env: SWARM_MAX_TOKENS_ENV, parse: parsePositiveIntEnv },
  maxTimeMsPerSwarm: { env: SWARM_MAX_TIME_MS_ENV, parse: parsePositiveIntEnv },
});

export const stripSwarmEnv = stripEnvBoundFields(swarmEnvBindings);

registerConfigSection(SWARM_SECTION, SwarmConfigSchema, {
  defaultValue: { timeoutMs: DEFAULT_SWARM_TIMEOUT_MS },
  env: swarmEnvBindings,
  stripEnv: stripSwarmEnv,
});

export function resolveSwarmTimeoutMs(config: IConfigService): number {
  return config.get<SwarmConfig | undefined>(SWARM_SECTION)?.timeoutMs ?? DEFAULT_SWARM_TIMEOUT_MS;
}

export function resolveSwarmBudget(config: IConfigService): { readonly turns?: number; readonly tokens?: number; readonly timeMs?: number } | undefined {
  const section = config.get<SwarmConfig | undefined>(SWARM_SECTION);
  const limits = {
    ...(section?.maxTurnsPerSwarm === undefined ? {} : { turns: section.maxTurnsPerSwarm }),
    ...(section?.maxTokensPerSwarm === undefined ? {} : { tokens: section.maxTokensPerSwarm }),
    ...(section?.maxTimeMsPerSwarm === undefined ? {} : { timeMs: section.maxTimeMsPerSwarm }),
  };
  return Object.keys(limits).length === 0 ? undefined : limits;
}
