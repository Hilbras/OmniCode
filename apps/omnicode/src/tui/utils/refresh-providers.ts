import {
  refreshProviderModels,
  type ProviderChange,
  type RefreshProviderOptions,
  type RefreshProviderScope,
  type RefreshResult,
} from '@hilbras/omnicode-auth';
import type { OmnicodeConfig, OmnicodeConfigPatch, OAuthRef } from '@hilbras/omnicode-api';

import { backfillBuiltInContextWindows } from '#/utils/builtin-model-import';
import { syncConfiguredFreeTiers } from '#/utils/free-tier-sync';

/**
 * CLI-side host for provider-model refresh. Kept on the SDK's full config types
 * so existing TUI callers (and tests) don't change; the daemon uses the oauth
 * package's `ManagedOmnicodeConfigShape`-typed host directly.
 */
export interface RefreshProviderHost {
  getConfig(): Promise<OmnicodeConfig>;
  removeProvider(providerId: string): Promise<OmnicodeConfig>;
  setConfig(patch: OmnicodeConfigPatch): Promise<OmnicodeConfig>;
  resolveOAuthToken(providerName: string, oauthRef?: OAuthRef): Promise<string>;
  /** Product User-Agent sent on custom-registry (api.json) fetches. */
  readonly userAgent?: string;
}

export type { ProviderChange, RefreshProviderOptions, RefreshProviderScope, RefreshResult };

/**
 * Refresh remote model metadata for the configured providers. Thin adapter over
 * the shared `refreshProviderModels` orchestrator in `@hilbras/omnicode-auth`
 * (which is also what the daemon's scheduled/manual refresh uses).
 */
export async function refreshAllProviderModels(
  host: RefreshProviderHost,
  options: RefreshProviderOptions = {},
): Promise<RefreshResult> {
  const result = await refreshProviderModels(
    {
      getConfig: () => host.getConfig(),
      removeProvider: (providerId) => host.removeProvider(providerId),
      setConfig: (patch) => host.setConfig(patch as unknown as OmnicodeConfigPatch),
      resolveOAuthToken: (providerName, oauthRef) =>
        host.resolveOAuthToken(providerName, oauthRef as unknown as OAuthRef),
      userAgent: host.userAgent,
    },
    options,
  );
  await backfillContextWindows(host, options.providerId);
  await syncConfiguredFreeTiers(
    { getConfig: () => host.getConfig(), setConfig: (patch) => host.setConfig(patch) },
    options.providerId,
  );
  return result;
}

/**
 * Upgrades aliases that still carry a flat default, or no declared window at
 * all, to the real context window from the models.dev catalog.
 *
 * A refresh merges the endpoint's own fields over each alias, and `/models`
 * declares no limits — so a value written by an older release survives the
 * refresh unchanged forever. Only re-running the catalog read converges it,
 * which is why this rides along with every refresh rather than only at add.
 */
async function backfillContextWindows(
  host: RefreshProviderHost,
  providerId?: string,
): Promise<void> {
  const config = await host.getConfig();
  const models = { ...config.models } as Record<string, Record<string, unknown>>;
  const ids = Object.keys(config.providers ?? {});
  const targets = providerId === undefined ? ids : ids.filter((id) => id === providerId);
  const touched = await backfillBuiltInContextWindows({ models, providerIds: targets });
  if (touched) {
    await host.setConfig({ models: models as OmnicodeConfig['models'] });
  }
}
