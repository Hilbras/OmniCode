import type { OmnicodeConfig, OmnicodeConfigPatch } from '@hilbras/api';

import {
  buildFreeTierAliases,
  fetchCatalogLimits,
  fetchFreeTierModelIds,
  pruneRetiredFreeTierAliases,
  type CatalogLimit,
} from './builtin-model-import';
import { getBuiltInProvider } from './built-in-providers';

export interface FreeTierSyncHost {
  getConfig(): Promise<OmnicodeConfig>;
  setConfig(patch: OmnicodeConfigPatch): Promise<OmnicodeConfig>;
}

function emptyLimits(): Map<string, CatalogLimit> {
  return new Map<string, CatalogLimit>();
}

/**
 * Brings every configured built-in provider's free tier up to date: fetches the
 * ids the free endpoint currently serves, prunes the ones it has retired, and
 * writes the rest.
 *
 * Free aliases are deliberately exempt from the provider refresh — they live on
 * a different endpoint that only the built-in table knows about — so without this
 * a model the vendor adds would never appear, and one it retires would linger.
 * Runs after a refresh so a full refresh, a login, or an add all converge.
 *
 * `providerId` narrows the work to one provider, matching how callers scope a
 * refresh. Failures are swallowed on purpose: a free endpoint being unreachable
 * must not fail a refresh that is otherwise succeeding over the paid catalog.
 *
 * Returns the aliases it wrote.
 */
export async function syncConfiguredFreeTiers(
  host: FreeTierSyncHost,
  providerId?: string,
): Promise<string[]> {
  const config = await host.getConfig();
  const providers = Object.keys(config.providers ?? {});
  const written: string[] = [];
  let models: Record<string, Record<string, unknown>> | undefined;

  for (const id of providers) {
    if (providerId !== undefined && id !== providerId) continue;
    const builtin = getBuiltInProvider(id);
    if (builtin?.freeTier === undefined) continue;

    const limits =
      builtin.catalogProvider === undefined ? emptyLimits() : await fetchCatalogLimits(builtin.catalogProvider);

    for (const source of builtin.freeTier) {
      const { ids, failure } = await fetchFreeTierModelIds(source);
      if (ids.length === 0) {
        if (failure !== undefined) {
          process.stderr.write(`[omnicode] ${id} free tier unreachable: ${failure.kind}\n`);
          continue;
        }
        process.stderr.write(`[omnicode] ${id} free tier offers no models; retiring its aliases\n`);
      }
      models ??= { ...config.models } as Record<string, Record<string, unknown>>;
      pruneRetiredFreeTierAliases({ models, providerId: id, liveIds: new Set(ids) });
      const aliases = buildFreeTierAliases({
        providerId: id,
        baseUrl: source.baseUrl,
        apiKey: source.apiKey,
        ids,
        limits,
      });
      Object.assign(models, aliases);
      written.push(...Object.keys(aliases));
    }
  }

  if (models !== undefined) {
    await host.setConfig({ models: models as OmnicodeConfig['models'] });
  }
  return written;
}