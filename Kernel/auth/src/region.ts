/**
 * Region profiles for the mainland-China (.com) and global (.ai)
 * Omnicode deployments, plus the resolver that decides which region a
 * client belongs to.
 *
 * A region is a bundle of endpoints (OAuth host, managed API base URL, CDN,
 * site, Remote Control relay, and telemetry when that region's collector is
 * live). The OAuth client_id is shared across regions and stays in
 * `./constants`.
 *
 * Resolution order (first match wins):
 *   1. env override (`OMNICODE_OAUTH_HOST` / `OMNICODE_OAUTH_HOST`)
 *   2. persisted login (the `oauthHost` stored in config.toml's oauth ref)
 *   3. persisted default-slot login (the oauth ref's key equals
 *      `OMNICODE_OAUTH_KEY` — a mainland-China login persists no
 *      `oauthHost`, so the default slot's presence is an explicit-mainland-cn
 *      signal that outranks the marker)
 *   4. install-channel marker file (`<home>/region`, written by install
 *      scripts; consultable only before the first login)
 *   5. default 'mainland-cn'
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { DEFAULT_OMNICODE_OAUTH_HOST } from './constants';
import { DEFAULT_OMNICODE_BASE_URL } from './managed-usage';
import {
  omnicodeCodeEnvBaseUrl,
  omnicodeCodeEnvOAuthHost,
  OMNICODE_OAUTH_KEY,
  resolveOmnicodeCodeOAuthRef,
} from './managed-omnicode';

export type OmnicodeRegion = 'mainland-cn' | 'global';

/** Zod schema for the wire/domain contract; parses to {@link OmnicodeRegion}. */
export const omnicodeRegionSchema = z.enum(['mainland-cn', 'global']);

export interface OmnicodeRegionProfile {
  /** OAuth host the device flow talks to (authorize/token derive from it). */
  readonly oauthHost: string;
  /** Managed API base (`/coding/v1`): usages, userinfo, models, feedback... */
  readonly baseUrl: string;
  /** Update/install/plugin-marketplace root. */
  readonly cdnBase: string;
  /** Official site root (docs, console, signup, upgrade pages). */
  readonly siteBase: string;
  /**
   * Cloud telemetry collector. Absent when that collector is not live; callers
   * must skip the send instead of falling back to another region's host.
   */
  readonly telemetryEndpoint?: string;
  /** Remote Control relay origin (`omnicode rc` / `/web` public URL). */
  readonly relayOrigin: string;
}

export const OMNICODE_REGION_PROFILES: Record<OmnicodeRegion, OmnicodeRegionProfile> = {
  'mainland-cn': {
    oauthHost: DEFAULT_OMNICODE_OAUTH_HOST,
    baseUrl: DEFAULT_OMNICODE_BASE_URL,
    cdnBase: 'https://code.omnicode.com/omnicode',
    siteBase: 'https://www.omnicode.com',
    telemetryEndpoint: 'https://telemetry-logs.omnicode.com/v1/event',
    relayOrigin: 'https://code-rc.omnicode.com',
  },
  global: {
    oauthHost: 'https://auth.omnicode.ai',
    baseUrl: 'https://api.omnicode.ai/coding/v1',
    cdnBase: 'https://code.omnicode.ai/omnicode',
    siteBase: 'https://www.omnicode.ai',
    relayOrigin: 'https://code-rc.omnicode.ai',
  },
};

export function omnicodeRegionProfile(region: OmnicodeRegion): OmnicodeRegionProfile {
  return OMNICODE_REGION_PROFILES[region];
}

/**
 * Content-CDN URL builder (tips banner, WebBridge / Computer-Use binaries).
 * International mirror coverage of cdn.omnicode.ai for these payloads is still
 * being confirmed, so both regions currently share the .com host — funnel
 * every content URL through here so flipping later touches one function.
 */
export function omnicodeCdnContentUrl(path: string): string {
  return `https://cdn.omnicode.com/${path.replace(/^\/+/, '')}`;
}

/**
 * Login hosts for an explicit region choice, or `undefined` when an env
 * override (`OMNICODE_OAUTH_HOST` / `OMNICODE_OAUTH_HOST` / `OMNICODE_BASE_URL`)
 * is in play — env keeps full control of endpoints, so a region pick must not
 * smuggle profile hosts past it (requested hosts outrank env in
 * `resolveOmnicodeCodeLoginAuth`).
 *
 * When returned, both hosts are always set — including for 'mainland-cn',
 * whose values equal the defaults. Passing them explicitly is what lets
 * "switch back to mainland China" override a previously persisted global
 * login in config.toml.
 */
export function omnicodeRegionLoginHosts(
  region: OmnicodeRegion,
  env: NodeJS.ProcessEnv = process.env,
): { readonly oauthHost: string; readonly baseUrl: string } | undefined {
  if (omnicodeCodeEnvOAuthHost(env) !== undefined || omnicodeCodeEnvBaseUrl(env) !== undefined) {
    return undefined;
  }
  const profile = omnicodeRegionProfile(region);
  return { oauthHost: profile.oauthHost, baseUrl: profile.baseUrl };
}

/**
 * Marker file name under the Omnicode home dir. Install scripts write a single
 * line (`mainland-cn` or `global`) here so a fresh client can default to the
 * region matching the channel it was installed from. It is only consulted
 * while the user has never logged in; a persisted login (config.toml) always
 * wins.
 */
export const OMNICODE_REGION_MARKER_FILENAME = 'region';

export interface ResolveOmnicodeRegionOptions {
  /** Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The `oauthHost` persisted in config.toml's oauth ref, if any. */
  readonly configuredOAuthHost?: string;
  /**
   * The credential key persisted in config.toml's oauth ref, if any. The
   * default slot ({@link OMNICODE_OAUTH_KEY}) only ever holds a
   * mainland-China login — mainland-cn persists no `oauthHost` — so its
   * presence is an explicit-mainland-cn signal that outranks the
   * install-channel marker.
   */
  readonly configuredOAuthKey?: string;
  /** Omnicode home dir; defaults to `OMNICODE_HOME` or `~/.omnicode`. */
  readonly homeDir?: string;
  /**
   * Set false to skip the install-channel marker (e.g. the desktop app's
   * embedded server, which is not installed through a channel script and
   * leaves the region choice entirely to the login UI).
   */
  readonly readMarker?: boolean;
}

function normalizeHost(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function regionForOAuthHost(oauthHost: string): OmnicodeRegion | undefined {
  const normalized = normalizeHost(oauthHost);
  for (const region of Object.keys(OMNICODE_REGION_PROFILES) as OmnicodeRegion[]) {
    if (normalizeHost(OMNICODE_REGION_PROFILES[region].oauthHost) === normalized) return region;
  }
  return undefined;
}

function readRegionMarker(homeDir: string): OmnicodeRegion | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(homeDir, OMNICODE_REGION_MARKER_FILENAME), 'utf-8');
  } catch {
    return undefined;
  }
  const value = raw.trim();
  return value === 'mainland-cn' || value === 'global' ? value : undefined;
}

// Mirrors `defaultOmnicodeHome` in ./toolkit; keep the two in sync so the marker
// always lands next to the credentials dir it describes.
function defaultHomeDir(env: NodeJS.ProcessEnv): string {
  const override = env['OMNICODE_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.omnicode');
}

export function resolveOmnicodeRegion(options: ResolveOmnicodeRegionOptions = {}): OmnicodeRegion {
  const env = options.env ?? process.env;
  // An env host that matches a profile pins the region. An unknown env host
  // means a custom/internal environment: the per-endpoint env overrides keep
  // doing their job regardless of region, so skip straight to the default
  // instead of letting a stale config/marker point CDN links somewhere odd.
  const envHost = env['OMNICODE_OAUTH_HOST'] ?? env['OMNICODE_AUTH_HOST'];
  if (envHost !== undefined && envHost.length > 0) {
    return regionForOAuthHost(envHost) ?? 'mainland-cn';
  }
  const configured = options.configuredOAuthHost;
  if (configured !== undefined && configured.length > 0) {
    const configuredRegion = regionForOAuthHost(configured);
    if (configuredRegion !== undefined) return configuredRegion;
  }
  if (options.configuredOAuthKey === OMNICODE_OAUTH_KEY) return 'mainland-cn';
  if (options.readMarker !== false) {
    const markerRegion = readRegionMarker(options.homeDir ?? defaultHomeDir(env));
    if (markerRegion !== undefined) return markerRegion;
  }
  return 'mainland-cn';
}

export interface OmnicodeRemoteControlAuth {
  readonly region: OmnicodeRegion;
  readonly oauthKey: string;
  readonly relayOrigin: string;
}

/**
 * One region judgment for Remote Control: credential slot + relay origin.
 *
 * `oauthKey` is the persisted login slot when `configuredOAuthKey` is set
 * (including custom `omnicode-env-*` environments); otherwise the official
 * slot for the resolved region. `relayOrigin` follows the resolved region
 * profile, except that a custom-env login — a scoped slot outside the two
 * official ones, without a recognized `configuredOAuthHost` — keeps the
 * mainland relay: an install-channel marker must not flip a custom
 * environment to `.ai`.
 */
export function resolveOmnicodeRemoteControlAuth(
  options: ResolveOmnicodeRegionOptions = {},
): OmnicodeRemoteControlAuth {
  const region = resolveOmnicodeRegion(options);
  const profile = omnicodeRegionProfile(region);
  const configuredKey = options.configuredOAuthKey;
  const customSlot =
    configuredKey !== undefined &&
    configuredKey !== OMNICODE_OAUTH_KEY &&
    configuredKey !==
      resolveOmnicodeCodeOAuthRef({
        oauthHost: OMNICODE_REGION_PROFILES.global.oauthHost,
        baseUrl: OMNICODE_REGION_PROFILES.global.baseUrl,
      }).key;
  const hostPinned =
    options.configuredOAuthHost !== undefined &&
    regionForOAuthHost(options.configuredOAuthHost) !== undefined;
  return {
    region,
    oauthKey:
      configuredKey ??
      resolveOmnicodeCodeOAuthRef({
        oauthHost: profile.oauthHost,
        baseUrl: profile.baseUrl,
      }).key,
    relayOrigin:
      customSlot && !hostPinned
        ? OMNICODE_REGION_PROFILES['mainland-cn'].relayOrigin
        : profile.relayOrigin,
  };
}
