import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import { parseBooleanEnv, parseNumberEnv } from '@hilbras/omnicode-base/utils/env';

/** Reminder variant carrying the loop warning injected before the model's next step. */
export const TEXT_LOOP_REMINDER_VARIANT = 'text_loop';

/** Set to `0`/`false`/`off` to disable the streaming text-loop watch. */
export const TEXT_LOOP_WATCH_ENV = 'OMNICODE_TEXT_LOOP_BREAKER';

/**
 * Reminder variant for tool-result stagnation. Separate from `text_loop` so a
 * stalled tool run never masquerades as repeated prose, and so either channel
 * can be tuned or muted without touching the other.
 */
export const RESULT_STAGNATION_REMINDER_VARIANT = 'result_stagnation';

/** Set to `0`/`false`/`off` to disable the tool-result stagnation watch. */
export const RESULT_STAGNATION_WATCH_ENV = 'OMNICODE_RESULT_STAGNATION_BREAKER';

/**
 * Maximum loop/stagnation reminders injected in one turn, across both
 * variants. Anything that is not a positive integer leaves the default.
 */
export const LOOP_REMINDER_CAP_ENV = 'OMNICODE_LOOP_REMINDER_CAP';

/** Reminders per turn before the watch goes quiet for the rest of the turn. */
export const DEFAULT_LOOP_REMINDER_CAP = 3;

export interface LoopWatchConfig {
  readonly textEnabled: boolean;
  readonly stagnationEnabled: boolean;
  readonly reminderCap: number;
}

/** The subset of `LoopWatchConfig` a caller may override. */
export interface LoopWatchConfigOverrides {
  readonly textEnabled?: boolean;
  readonly stagnationEnabled?: boolean;
  readonly reminderCap?: number;
}

const LOOP_WATCH_DEFAULTS: LoopWatchConfig = {
  textEnabled: true,
  stagnationEnabled: true,
  reminderCap: DEFAULT_LOOP_REMINDER_CAP,
};

function configured<T>(
  env: NodeJS.ProcessEnv | undefined,
  key: string,
  fallback: T,
  coerce: (raw: string | undefined) => T | undefined,
): T {
  if (env === undefined) return fallback;
  return coerce(env[key]) ?? fallback;
}

function coerceTextEnabled(raw: string | undefined): boolean | undefined {
  const parsed = parseBooleanEnv(raw);
  return parsed === undefined ? undefined : parsed;
}

function coercePositiveInteger(raw: string | undefined): number | undefined {
  const parsed = parseNumberEnv(raw);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

/**
 * Resolves the watch configuration from an environment map. `undefined` means
 * "nothing configured": the caller substitutes `process.env`, so the pure
 * resolution path never reads the ambient environment itself.
 */
export function resolveLoopWatchConfig(env?: NodeJS.ProcessEnv): LoopWatchConfig {
  return {
    textEnabled: configured(env, TEXT_LOOP_WATCH_ENV, LOOP_WATCH_DEFAULTS.textEnabled, coerceTextEnabled),
    stagnationEnabled: configured(
      env,
      RESULT_STAGNATION_WATCH_ENV,
      LOOP_WATCH_DEFAULTS.stagnationEnabled,
      coerceTextEnabled,
    ),
    reminderCap: configured(env, LOOP_REMINDER_CAP_ENV, LOOP_WATCH_DEFAULTS.reminderCap, coercePositiveInteger),
  };
}

export interface IAgentTextLoopWatchService {
  readonly _serviceBrand: undefined;
  /** Overrides part of the resolved watch configuration for this scope. */
  configure(overrides: LoopWatchConfigOverrides): void;
}

export const IAgentTextLoopWatchService: ServiceIdentifier<IAgentTextLoopWatchService> =
  createDecorator<IAgentTextLoopWatchService>('agentTextLoopWatchService');


