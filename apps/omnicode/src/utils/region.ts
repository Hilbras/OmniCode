/**
 * Process-wide region cache for the CLI/TUI.
 *
 * Region decides which deployment (mainland-China .com / international .ai)
 * the client's off-session endpoints point at: CDN (updates, plugins, tips),
 * site links, telemetry. The OAuth login flow itself does NOT read this — it
 * takes explicit hosts; this cache is for everything derived afterwards.
 *
 * Resolution lives in `@hilbras/omnicode-auth` (see `resolveOmnicodeRegion`);
 * this module only adds the one thing that package deliberately does not own:
 * reading the persisted login's oauth ref (credential key + `oauthHost`) out
 * of config.toml, synchronously, via the SDK's safe config reader. First call
 * wins; `refreshOmnicodeRegion` re-resolves after login/logout rewrote the oauth
 * ref.
 */

import { loadRuntimeConfigSafe, resolveConfigPath } from '@hilbras/omnicode-sdk';
import {
  OMNICODE_OAUTH_KEY,
  OMNICODE_REGION_PROFILES,
  resolveOmnicodeRegion,
  type OmnicodeRegion,
  type OmnicodeRegionProfile,
} from '@hilbras/omnicode-auth';

// Same value as DEFAULT_OAUTH_PROVIDER_NAME in '#/constant/app' — inlined here
// to keep the import one-directional (constant/app derives URLs from this
// module, so this module must not import back from it).
const MANAGED_OMNICODE_PROVIDER_KEY = 'managed:omnicode';

/** Platform-selector value for the global OAuth login entry. */
export const OMNICODE_GLOBAL_PLATFORM_VALUE = 'omnicode-global';

let cached: OmnicodeRegion | undefined;

export interface PersistedOmnicodeOAuthRef {
  readonly key: string;
  readonly oauthHost?: string;
}

/** The oauth ref persisted by a previous login, if any. */
export function persistedOmnicodeOAuthRef(): PersistedOmnicodeOAuthRef | undefined {
  const result = loadRuntimeConfigSafe(resolveConfigPath({}));
  // `providers` is always present on a real config load; the `?.` guards
  // hosts/tests that hand us a partial config shape.
  const oauth = result.config.providers?.[MANAGED_OMNICODE_PROVIDER_KEY]?.oauth;
  if (oauth === undefined) return undefined;
  return { key: oauth.key, oauthHost: oauth.oauthHost };
}

/** Region for a no-flag `omnicode login` / `omnicode acp --login`: a fresh install
    follows the resolved region (env/marker/default); the default slot (only
    ever a mainland-cn login) re-pins the profile explicitly; a scoped slot —
    a global login, or a custom env persisted with only OMNICODE_BASE_URL and
    no oauthHost — keeps its configured hosts (`undefined`). */
export function regionForBareLogin(ref: PersistedOmnicodeOAuthRef | undefined): OmnicodeRegion | undefined {
  if (ref === undefined) return currentOmnicodeRegion();
  return ref.key === OMNICODE_OAUTH_KEY ? 'mainland-cn' : undefined;
}

export function currentOmnicodeRegion(): OmnicodeRegion {
  if (cached === undefined) {
    const persisted = persistedOmnicodeOAuthRef();
    cached = resolveOmnicodeRegion({
      configuredOAuthHost: persisted?.oauthHost,
      configuredOAuthKey: persisted?.key,
      readMarker: process.env['OMNICODE_REGION_MARKER'] !== 'off',
    });
  }
  return cached;
}

export function currentOmnicodeProfile(): OmnicodeRegionProfile {
  return OMNICODE_REGION_PROFILES[currentOmnicodeRegion()];
}

/** Drop the cache and re-resolve. Call after login/logout rewrote config. */
export function refreshOmnicodeRegion(): OmnicodeRegion {
  cached = undefined;
  return currentOmnicodeRegion();
}
