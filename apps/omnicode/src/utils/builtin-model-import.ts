import { DEFAULT_CATALOG_URL } from '@hilbras/omnicode-sdk';

import { fetchCatalogOrBuiltIn } from './catalog-fetch';

export const DEFAULT_MAX_CONTEXT = 131072;

export interface CatalogLimit {
  readonly context: number;
  readonly input?: number;
  readonly output?: number;
}

export interface ImportedModel {
  readonly id: string;
  readonly baseUrl: string;
  readonly maxContextSize: number;
  readonly maxInputSize?: number;
  readonly maxOutputSize?: number;
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

function readLimit(entry: unknown): CatalogLimit | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const limit = (entry as { limit?: Record<string, unknown> }).limit;
  if (typeof limit !== 'object' || limit === null) return undefined;
  const rec = limit as Record<string, unknown>;
  const context = positiveInt(rec['context']);
  if (context === undefined) return undefined;
  return { context, input: positiveInt(rec['input']), output: positiveInt(rec['output']) };
}

/**
 * Real context windows from models.dev, keyed by model id.
 *
 * Neither `/models` route returns a context field, so without this every model
 * is declared with one flat default. A missing catalog is not an error: the
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
      const limit = readLimit(entry);
      if (limit !== undefined) out.set(id, limit);
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * The ids a vendor's free-tier endpoint owns.
 *
 * A source that is unreachable yields nothing rather than throwing: the ids are
 * then simply absent, which is the correct outcome when the vendor is down.
 */
export async function fetchFreeTierModelIds(
  source: { readonly baseUrl: string; readonly match: readonly string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `${source.baseUrl.replace(/\/+$/, '')}/models`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const payload = (await res.json()) as { data?: { id?: unknown }[] };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows
      .map((row) => (typeof row?.id === 'string' ? row.id : undefined))
      .filter((id): id is string => id !== undefined)
      .filter((id) => source.match.some((pattern) => matchesPattern(id, pattern)));
  } catch {
    return [];
  }
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
    };
  });
}