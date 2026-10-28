import { DEFAULT_CATALOG_URL } from '@hilbras/omnicode-api';

import { fetchCatalogOrBuiltIn } from './catalog-fetch';
import { getBuiltInProvider } from './built-in-providers';

export const DEFAULT_MAX_CONTEXT = 131072;

export interface CatalogLimit {
  readonly context: number;
  readonly input?: number;
  readonly output?: number;
  /** What the model can do, as the catalog states it: `image_in`, `video_in`,
   * `audio_in`, `thinking` (or `always_thinking`), `tool_use`. */
  readonly capabilities?: readonly string[];
}

export interface ImportedModel {
  readonly id: string;
  readonly baseUrl: string;
  readonly maxContextSize: number;
  readonly maxInputSize?: number;
  readonly maxOutputSize?: number;
  readonly capabilities?: readonly string[];
}

/**
 * Whether `id` is named by a pattern: `claude-*` is a prefix, `*-free` a suffix,
 * anything else an exact id. Same three shapes as the `excluded_models` reader,
 * kept local so the app layer stays on the SDK and never imports an engine
 * package.
 */
export function matchesPattern(id: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('*')) return id.endsWith(pattern.slice(1));
  return id === pattern;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

/**
 * The input modalities a catalog model accepts.
 *
 * The catalog is the only source that knows whether a model reads images, and
 * a model without `image_in` never gets the image tool — so the flags are read
 * from the catalog instead of being assumed per provider.
 */
function readInputModalities(modalities: unknown): readonly string[] {
  if (typeof modalities !== 'object' || modalities === null) return [];
  const input = (modalities as Record<string, unknown>)['input'];
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === 'string');
}

/**
 * Whether the catalog marks the model as reasoning, and whether reasoning can
 * be switched off. A model whose effort levels have no "none" tier always
 * reasons, so the UI locks thinking on for it.
 */
function readThinkingCapability(rec: Record<string, unknown>): 'always' | 'toggle' | undefined {
  const options = rec['reasoning_options'];
  const list = Array.isArray(options) ? options : [];
  let hasSelectable = false;
  let hasOff = false;
  let hasToggle = false;
  for (const option of list) {
    if (typeof option !== 'object' || option === null) continue;
    const opt = option as Record<string, unknown>;
    if (opt['type'] === 'toggle') {
      hasToggle = true;
      continue;
    }
    if (opt['type'] !== 'effort') continue;
    const values = opt['values'];
    if (!Array.isArray(values)) continue;
    if (values.some((value) => value === null)) hasOff = true;
    for (const value of values) {
      if (typeof value !== 'string' || value.length === 0) continue;
      if (value.toLowerCase() === 'none') {
        hasOff = true;
        continue;
      }
      hasSelectable = true;
    }
  }
  if (hasSelectable && !hasOff && !hasToggle) return 'always';
  if (rec['reasoning'] === true || hasSelectable || hasToggle) return 'toggle';
  return undefined;
}

function readCapabilities(entry: unknown): readonly string[] | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const rec = entry as Record<string, unknown>;
  const inputs = readInputModalities(rec['modalities']);
  const caps: string[] = [];
  if (inputs.includes('image')) caps.push('image_in');
  if (inputs.includes('video')) caps.push('video_in');
  if (inputs.includes('audio')) caps.push('audio_in');
  const thinking = readThinkingCapability(rec);
  if (thinking === 'always') caps.push('always_thinking');
  else if (thinking === 'toggle') caps.push('thinking');
  if (rec['tool_call'] !== false) caps.push('tool_use');
  if (rec['dynamically_loaded_tools'] === true) caps.push('dynamically_loaded_tools');
  return caps.length > 0 ? caps : undefined;
}

/**
 * Anthropic and Omnicode protocols reason on every request, so a model marked
 * "always thinking" there still offers the thinking switch. The engine drops
 * the same flag for those wires; the alias must agree with it.
 */
function withoutAlwaysThinking(
  caps: readonly string[],
  catalogProvider: string,
): readonly string[] {
  if (catalogProvider !== 'anthropic' && catalogProvider !== 'omnicode') return caps;
  return caps.map((cap) => (cap === 'always_thinking' ? 'thinking' : cap));
}

function readLimit(entry: unknown, catalogProvider: string): CatalogLimit | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const limit = (entry as { limit?: Record<string, unknown> }).limit;
  if (typeof limit !== 'object' || limit === null) return undefined;
  const rec = limit as Record<string, unknown>;
  const context = positiveInt(rec['context']);
  if (context === undefined) return undefined;
  const capabilities = readCapabilities(entry);
  return {
    context,
    input: positiveInt(rec['input']),
    output: positiveInt(rec['output']),
    capabilities:
      capabilities === undefined
        ? undefined
        : withoutAlwaysThinking(capabilities, catalogProvider),
  };
}

/**
 * Real context windows, output limits and capabilities from models.dev, keyed
 * by model id.
 *
 * Neither `/models` route returns a limit field, so without this every model
 * is declared with one flat default — and a compaction request then asks for a
 * 128k output the model never allowed. A missing catalog is not an error: the
 * caller falls back to the default rather than failing the add.
 */
export async function fetchCatalogLimits(
  catalogProvider: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, CatalogLimit>> {
  const out = new Map<string, CatalogLimit>();
  try {
    const { catalog } = await fetchCatalogOrBuiltIn(DEFAULT_CATALOG_URL, { fetchImpl });
    const models = catalog?.[catalogProvider]?.models;
    if (models === undefined) return out;
    for (const [id, entry] of Object.entries(models)) {
      const limit = readLimit(entry, catalogProvider);
      if (limit !== undefined) out.set(id, limit);
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * The ids a vendor's free-tier endpoint owns.
 */
export type FreeTierFetchFailure =
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'network'; readonly message: string };

export interface FreeTierFetchResult {
  readonly ids: readonly string[];
  readonly failure?: FreeTierFetchFailure;
}

/**
 * Fetches the ids a vendor's free tier owns, and reports WHY an empty result
 * is empty.
 *
 * The failure is part of the return value rather than swallowed: the same
 * built-in also excludes these ids from its paid route, so a fetch that fails
 * quietly makes the models disappear from every surface at once with nothing
 * reported. Callers must surface it.
 */
export async function fetchFreeTierModelIds(
  source: { readonly baseUrl: string; readonly match: readonly string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<FreeTierFetchResult> {
  const url = `${source.baseUrl.replace(/\/+$/, '')}/models`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ids: [], failure: { kind: 'http', status: res.status } };
    const payload = (await res.json()) as { data?: { id?: unknown }[] };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const ids = rows
      .map((row) => (typeof row?.id === 'string' ? row.id : undefined))
      .filter((id): id is string => id !== undefined)
      .filter((id) => source.match.some((pattern) => matchesPattern(id, pattern)));
    return { ids };
  } catch (error) {
    return {
      ids: [],
      failure: { kind: 'network', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export function describeFreeTierFailure(
  baseUrl: string,
  failure: FreeTierFetchFailure | undefined,
): string {
  if (failure === undefined) {
    return `${baseUrl} answered, but listed none of the expected free model ids.`;
  }
  const cause =
    failure.kind === 'http' ? `HTTP ${failure.status}` : `network error: ${failure.message}`;
  return `${baseUrl} could not be reached (${cause}); no free models were added.`;
}

/**
 * Assembles the alias rows for a free-tier endpoint, enriched from the catalog
 * so their declared context is the real one rather than the flat default.
 */
export function buildImportedModels(input: {
  readonly providerId: string;
  readonly ids: readonly string[];
  readonly baseUrl: string;
  readonly limits: ReadonlyMap<string, CatalogLimit>;
}): ImportedModel[] {
  return input.ids.map((id) => {
    const limit = input.limits.get(id);
    return {
      id,
      baseUrl: input.baseUrl,
      maxContextSize: limit?.context ?? DEFAULT_MAX_CONTEXT,
      maxInputSize: limit?.input,
      maxOutputSize: limit?.output,
      capabilities: limit?.capabilities,
    };
  });
}

/**
 * Builds the config alias rows for a vendor's free tier.
 *
 * Shared by every add-a-built-in path (CLI and TUI). A free-tier alias carries
 * its own `base_url`, the literal credential that tier expects, and the
 * `free_tier` marker the engine reads to emit the vendor client fingerprint —
 * a path that forgets the marker yields aliases that list but then fail, and
 * a path that forgets the aliases entirely loses the free models, because the
 * same built-in also excludes those ids from the paid route.
 */
export function buildFreeTierAliases(input: {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly ids: readonly string[];
  readonly limits: ReadonlyMap<string, CatalogLimit>;
}): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const imported of buildImportedModels(input)) {
    out[`${input.providerId}/${imported.id}`] = {
      provider: input.providerId,
      model: imported.id,
      baseUrl: imported.baseUrl,
      apiKey: input.apiKey,
      freeTier: true,
      maxContextSize: imported.maxContextSize,
      maxInputSize: imported.maxInputSize,
      maxOutputSize: imported.maxOutputSize,
      capabilities: imported.capabilities ?? ['tool_use'],
      displayName: imported.id,
    };
  }
  return out;
}
/**
 * Merges the catalog's capabilities into what an alias already declares.
 *
 * The merge only adds: a capability the user declared by hand is never
 * dropped, and a model the catalog does not know keeps the flags it has.
 */
function mergeCapabilities(existing: unknown, incoming: readonly string[] | undefined): unknown {
  const current = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === 'string')
    : [];
  if (incoming === undefined) return existing;
  const merged = [...current];
  for (const cap of incoming) {
    if (!merged.includes(cap)) merged.push(cap);
  }
  return merged;
}

/**
 * Fills the real limits and capabilities from the models.dev catalog onto
 * aliases that discovery already wrote, so both add surfaces produce the same
 * config.
 *
 * The context window is only replaced while it still holds the flat default:
 * one the user hand-tuned keeps whatever they chose. Input/output limits and
 * capabilities are filled in whenever the alias does not carry them yet, and
 * capabilities are merged rather than replaced. Returns whether anything
 * changed.
 */
export function backfillCatalogLimits(input: {
  readonly models: Record<string, Record<string, unknown>>;
  readonly providerId: string;
  readonly limits: ReadonlyMap<string, CatalogLimit>;
}): boolean {
  let touched = false;
  for (const [key, record] of Object.entries(input.models)) {
    if (!key.startsWith(`${input.providerId}/`)) continue;
    if (record === null || typeof record !== 'object') continue;
    const id = typeof record['model'] === 'string' ? record['model'] : undefined;
    if (id === undefined) continue;
    const limit = input.limits.get(id);
    if (limit === undefined) continue;
    const next: Record<string, unknown> = { ...record };
    const current = record['maxContextSize'];
    if (current === undefined || current === DEFAULT_MAX_CONTEXT) {
      next['maxContextSize'] = limit.context;
    }
    if (limit.input !== undefined && record['maxInputSize'] === undefined) {
      next['maxInputSize'] = limit.input;
    }
    if (limit.output !== undefined && record['maxOutputSize'] === undefined) {
      next['maxOutputSize'] = limit.output;
    }
    const capabilities = mergeCapabilities(record['capabilities'], limit.capabilities);
    if (capabilities !== undefined) next['capabilities'] = capabilities;
    if (JSON.stringify(next) === JSON.stringify(record)) continue;
    input.models[key] = next;
    touched = true;
  }
  return touched;
}

/**
 * Fills the real limits and capabilities onto every configured built-in
 * provider's aliases.
 *
 * Runs after a provider refresh: `/models` answers with ids and no limits, so a
 * refresh that preserves an alias keeps whatever it already held — including a
 * flat default written by an older release. Without this pass a config written
 * before real values were resolved never converges on them, and the user has to
 * re-add the provider to see a real context window.
 *
 * Providers with no `catalogProvider`, and an unreachable catalog, are no-ops.
 */
export async function backfillBuiltInModelMetadata(input: {
  readonly models: Record<string, Record<string, unknown>>;
  readonly providerIds: readonly string[];
  readonly fetchImpl?: typeof fetch;
}): Promise<boolean> {
  let touched = false;
  for (const providerId of input.providerIds) {
    const catalogProvider = getBuiltInProvider(providerId)?.catalogProvider;
    if (catalogProvider === undefined) continue;
    const limits = await fetchCatalogLimits(catalogProvider, input.fetchImpl ?? fetch);
    if (limits.size === 0) continue;
    if (backfillCatalogLimits({ models: input.models, providerId, limits })) touched = true;
  }
  return touched;
}

/**
 * Drops free-tier aliases for a provider that the free endpoint no longer
 * offers.
 *
 * Free aliases are deliberately exempt from the provider refresh, so nothing
 * else would ever remove a model the vendor has retired: the alias would sit
 * in config until something asked for it and failed. Called alongside the
 * write that adds the current set, so re-adding a provider converges on what
 * the endpoint actually serves. Only `free_tier` aliases are considered.
 */
export function pruneRetiredFreeTierAliases(input: {
  readonly models: Record<string, Record<string, unknown>>;
  readonly providerId: string;
  readonly liveIds: ReadonlySet<string>;
}): string[] {
  const removed: string[] = [];
  for (const [alias, record] of Object.entries(input.models)) {
    if (record === null || typeof record !== 'object') continue;
    if (record['freeTier'] !== true) continue;
    if (!alias.startsWith(`${input.providerId}/`)) continue;
    const id = typeof record['model'] === 'string' ? record['model'] : undefined;
    if (id === undefined || input.liveIds.has(id)) continue;
    delete input.models[alias];
    removed.push(alias);
  }
  return removed;
}
