import { gt, valid } from 'semver';
import { z } from 'zod';

import { NPM_PACKAGE_NAME } from '#/constant/app';

const REGISTRY_DIST_TAGS_URL = `https://registry.npmjs.org/${encodeURIComponent(
  NPM_PACKAGE_NAME,
).replace('%40', '@')}/dist-tags`;

const REGISTRY_CHECK_TIMEOUT_MS = 3_000;

export const NpmDistTagsSchema = z.object({
  latest: z.string().min(1),
});

export type RegistryUpdateCheck =
  | { readonly status: 'available'; readonly latest: string }
  | { readonly status: 'current' }
  | { readonly status: 'error'; readonly reason: string };

/**
 * True when `latest` is a valid, strictly-newer stable semver version of
 * `current`. Prerelease targets never count as an available update.
 */
export function isUpdateAvailable(current: string, latest: string): boolean {
  if (valid(current) === null || valid(latest) === null) return false;
  if (valid(latest)?.includes('-') === true) return false;
  return gt(latest, current);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  timeoutMs: number,
): Promise<{ response: Response; done: () => void }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(input, { signal: controller.signal });
    // The timer stays armed across the body read: a stalled response body
    // must hit the same deadline as the headers. The consumer calls `done()`
    // once the body is settled.
    return { response, done: () => clearTimeout(timeout) };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Fetch the `latest` dist-tag from the npm registry.
 *
 * **Throws** on any failure (network error, non-2xx, malformed JSON, invalid
 * semver). Callers in the startup path must catch — a failed check is an
 * explicit error state, never silently reported as "up to date".
 *
 * `fetchImpl` is injectable for tests; the URL is derived from the package
 * name so a rename propagates to the check automatically.
 */
export async function fetchLatestVersionFromRegistry(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REGISTRY_CHECK_TIMEOUT_MS,
): Promise<string> {
  const { response, done } = await fetchWithTimeout(fetchImpl, REGISTRY_DIST_TAGS_URL, timeoutMs);
  try {
    if (!response.ok) {
      throw new Error(`npm registry dist-tags returned HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('npm registry dist-tags returned malformed JSON');
    }
    const parsed = NpmDistTagsSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error('npm registry dist-tags missing a latest tag');
    }
    if (valid(parsed.data.latest) === null) {
      throw new Error(`npm registry latest tag is not a valid semver: ${JSON.stringify(parsed.data.latest)}`);
    }
    return parsed.data.latest;
  } finally {
    done();
  }
}

/**
 * The startup-path registry check: never throws. Distinguishes "no update",
 * "update available", and "the check itself failed" — the last is logged by
 * the caller, not swallowed.
 */
export async function checkRegistryForUpdate(
  currentVersion: string,
  fetchImpl?: typeof fetch,
  timeoutMs?: number,
): Promise<RegistryUpdateCheck> {
  let latest: string;
  try {
    latest = await fetchLatestVersionFromRegistry(
      fetchImpl ?? fetch,
      timeoutMs ?? REGISTRY_CHECK_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (isUpdateAvailable(currentVersion, latest)) {
    return { status: 'available', latest };
  }
  return { status: 'current' };
}
