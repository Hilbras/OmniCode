import { createOmnicodeDeviceId, OMNICODE_PROVIDER_NAME } from '@hilbras/omnicode-auth';
import {
  OmnicodeAuthFacade,
  loadRuntimeConfigSafe,
  log,
  resolveConfigPath,
  resolveOmnicodeHome,
  type OmnicodeConfig,
  type TelemetryClient,
} from '@hilbras/omnicode-api';

import type { PromptHarness } from './prompt-session';
import {
  configureOtlpRuntime,
  DEFAULT_OTLP_FLUSH_INTERVAL_MS,
  initializeTelemetry,
  setTelemetryContext,
  track,
  withTelemetryContext,
} from '@hilbras/omnicode-telemetry';

import { CLI_USER_AGENT_PRODUCT, WEB_UI_MODE } from '#/constant/app';
import { currentOmnicodeProfile } from '#/utils/region';

import { createOmnicodeCodeHostIdentity } from './version';

export const OTLP_ENDPOINT_ENV = 'OMNICODE_OTLP_ENDPOINT';
export const OTLP_TOKEN_ENV = 'OMNICODE_OTLP_TOKEN';
export const OTLP_FLUSH_INTERVAL_ENV = 'OMNICODE_OTLP_FLUSH_INTERVAL_MS';

/**
 * Turns on OTLP span/metric export for this process when an endpoint is
 * configured. The endpoint comes from the environment read here, at the host
 * boundary; the token is re-read per send so a rotated value takes effect
 * without a restart. No endpoint means OTLP stays off — nothing is recorded,
 * and no default collector is ever assumed. The engine records spans/metrics
 * through the leaf's runtime only while this configuration is active.
 */
export function configureCliOtlpTelemetry(): void {
  if (readOtlpEndpoint() === undefined) {
    if ((process.env[OTLP_ENDPOINT_ENV] ?? '').trim().length > 0) {
      log.warn('ignoring invalid OTLP endpoint; OTLP telemetry stays off', {
        env: OTLP_ENDPOINT_ENV,
      });
    }
    return;
  }
  configureOtlpRuntime({
    endpoint: () => readOtlpEndpoint(),
    serviceName: CLI_USER_AGENT_PRODUCT,
    getAccessToken: () => process.env[OTLP_TOKEN_ENV] || null,
    flushIntervalMs: readOtlpFlushIntervalMs() ?? DEFAULT_OTLP_FLUSH_INTERVAL_MS,
  });
}

function readOtlpEndpoint(): string | undefined {
  const raw = (process.env[OTLP_ENDPOINT_ENV] ?? '').trim();
  if (raw.length === 0) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  return raw;
}

function readOtlpFlushIntervalMs(): number | undefined {
  const raw = process.env[OTLP_FLUSH_INTERVAL_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export interface CliTelemetryBootstrap {
  readonly homeDir: string;
  readonly deviceId: string;
  readonly firstLaunch: boolean;
}

export interface InitializeCliTelemetryOptions {
  readonly harness: PromptHarness;
  readonly bootstrap: CliTelemetryBootstrap;
  readonly config: Pick<OmnicodeConfig, 'defaultModel' | 'telemetry'>;
  readonly version: string;
  readonly uiMode: string;
  readonly model?: string;
  readonly sessionId?: string;
}

export function createCliTelemetryBootstrap(): CliTelemetryBootstrap {
  let firstLaunch = false;
  const homeDir = resolveOmnicodeHome();
  const deviceId = createOmnicodeDeviceId(homeDir, {
    onFirstLaunch: () => {
      firstLaunch = true;
    },
  });
  return { homeDir, deviceId, firstLaunch };
}

export function initializeCliTelemetry(options: InitializeCliTelemetryOptions): void {
  initializeTelemetry({
    homeDir: options.harness.homeDir,
    deviceId: options.bootstrap.deviceId,
    enabled: options.config.telemetry !== false,
    appName: CLI_USER_AGENT_PRODUCT,
    version: options.version,
    uiMode: options.uiMode,
    model: options.model ?? options.config.defaultModel,
    sessionId: options.sessionId,
    endpoint: () => currentOmnicodeProfile().telemetryEndpoint,
    getAccessToken: async () =>
      (await options.harness.auth.getCachedAccessToken(OMNICODE_PROVIDER_NAME)) ?? null,
    onUnexpectedError: (error) => log.warn('telemetry property dropped', { error: String(error) }),
  });
  if (options.bootstrap.firstLaunch) {
    options.harness.track('first_launch');
  }
}

export interface InitializeServerTelemetryOptions {
  readonly version: string;
}

/**
 * Bootstrap telemetry for the `omnicode web` host.
 *
 * Mirrors {@link initializeCliTelemetry}: mints the device id, reads config to
 * honor the `telemetry` toggle and pick up the default model, and attaches the
 * sink with `ui_mode = "web"`.
 *
 * The returned client wraps the `@hilbras/omnicode-telemetry` module
 * functions, so the module-level `track` / `withTelemetryContext` (used to
 * fire the startup event) share the same underlying client + sink.
 */
export function initializeServerTelemetry(
  options: InitializeServerTelemetryOptions,
): TelemetryClient {
  const bootstrap = createCliTelemetryBootstrap();
  const configPath = resolveConfigPath({ homeDir: bootstrap.homeDir });
  const config = readServerTelemetryConfig(configPath);
  const auth = new OmnicodeAuthFacade({
    homeDir: bootstrap.homeDir,
    configPath,
    identity: createOmnicodeCodeHostIdentity(options.version),
  });

  initializeTelemetry({
    homeDir: bootstrap.homeDir,
    deviceId: bootstrap.deviceId,
    enabled: config.telemetry !== false,
    appName: CLI_USER_AGENT_PRODUCT,
    version: options.version,
    uiMode: WEB_UI_MODE,
    model: config.defaultModel,
    endpoint: () => currentOmnicodeProfile().telemetryEndpoint,
    getAccessToken: async () => (await auth.getCachedAccessToken(OMNICODE_PROVIDER_NAME)) ?? null,
    onUnexpectedError: (error) => log.warn('telemetry property dropped', { error: String(error) }),
  });

  return {
    track,
    withContext: withTelemetryContext,
    setContext: setTelemetryContext,
  };
}

function readServerTelemetryConfig(
  configPath: string,
): Pick<OmnicodeConfig, 'telemetry' | 'defaultModel'> {
  try {
    const { config, fileError } = loadRuntimeConfigSafe(configPath);
    // A broken config fails the server on its own inside OmnicodeCore; for
    // telemetry just degrade to "enabled, no model" so we never block startup.
    if (fileError !== undefined) return {};
    return config;
  } catch {
    return {};
  }
}
