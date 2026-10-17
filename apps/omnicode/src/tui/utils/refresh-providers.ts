import {
  refreshProviderModels,
  type ProviderChange,
  type RefreshProviderOptions,
  type RefreshProviderScope,
  type RefreshResult,
} from '@hilbras/omnicode-auth';
import type { OmnicodeConfig, OmnicodeConfigPatch, OAuthRef } from '@hilbras/omnicode-api';

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
  await syncConfiguredFreeTiers(
    { getConfig: () => host.getConfig(), setConfig: (patch) => host.setConfig(patch) },
    options.providerId,
  );
  return result;
}
