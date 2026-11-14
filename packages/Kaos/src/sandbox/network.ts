import { KaosValueError } from '../errors';
import { sandboxFailure, sandboxSuccess, type SandboxResult } from './types';

/**
 * Network egress seam: destination authorization, the proxy seam, the
 * credential broker, and secret substitution.
 *
 * Ordering law — substitution happens only after destination authorization,
 * and the types make the order structural:
 *
 * 1. `authorizeSandboxNetworkDestination` turns a destination into a
 *    `SandboxNetworkAuthorization`, or fails. There is no authorization value
 *    for a denied destination.
 * 2. A credential broker releases credentials only for an *enforced*
 *    authorization (`mode: 'restricted'` whose host list matched). An
 *    unrestricted policy releases nothing: without host confinement a
 *    host-scoped credential would be leakable to any destination.
 * 3. `substituteSandboxSecrets` only sees released credentials, so an
 *    unauthorized destination can never observe a secret through a
 *    substituted value.
 *
 * Honesty about enforcement: the only proxy transport today is child env
 * (`HTTPS_PROXY`/`HTTP_PROXY`). A child that ignores proxy env vars can still
 * connect directly, so `proxy-env` egress is advisory routing, not
 * enforcement. A caller that must guarantee host confinement (the exec-policy
 * `hosts` amendment on a shell command) must not run on `proxy-env` and keeps
 * refusing until an OS-enforced transport exists. The status names itself so
 * no caller can mistake it for enforcement.
 *
 * Host matching is exact and matches the exec-policy `hosts` amendment shape:
 * case-insensitive hostname equality with one trailing dot stripped. Ports do
 * not participate; wildcards are rejected.
 */

export type SandboxNetworkEgressMode = 'unrestricted' | 'denied' | 'restricted';

export interface SandboxNetworkPolicy {
  readonly mode: SandboxNetworkEgressMode;
  /** Exact hostnames the destination must match under `restricted`. */
  readonly allowedHosts?: readonly string[];
}

export interface SandboxNetworkDestination {
  readonly host: string;
  readonly port?: number;
}

export interface SandboxNetworkAuthorization {
  /** Normalized destination host (lowercase, trailing dot stripped). */
  readonly host: string;
  readonly port: number | null;
  /** The allow entry that matched; `null` when the policy is unrestricted. */
  readonly matchedHost: string | null;
  /** True only when a host restriction authorized the destination. */
  readonly enforced: boolean;
}

const HOST_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const HOST_FORBIDDEN_CHARACTERS = /[\0\n\r\s/\\@:?#[\]%"'`^|<>{}$,;=!~]/;

function stripTrailingDot(host: string): string {
  return host.length > 1 && host.endsWith('.') ? host.slice(0, -1) : host;
}

function isPlausibleHostname(host: string): boolean {
  if (host.length === 0) return false;
  return host.split('.').every((label) => HOST_LABEL_PATTERN.test(label));
}

/** Normalizes one allow-listed host. Exact hostnames only; no wildcards, ports, or schemes. */
export function normalizeSandboxNetworkHost(host: string): SandboxResult<string> {
  if (typeof host !== 'string') {
    return sandboxFailure('invalid-request', 'network host must be a string');
  }
  const normalized = stripTrailingDot(host.trim().toLowerCase());
  if (normalized.length === 0) {
    return sandboxFailure('invalid-request', 'network host must be a non-empty hostname');
  }
  if (HOST_FORBIDDEN_CHARACTERS.test(normalized)) {
    return sandboxFailure('invalid-request', `network host must be a bare hostname: ${host}`);
  }
  if (normalized.includes('*') || normalized.includes('?')) {
    return sandboxFailure('invalid-request', `network host entries must be exact hostnames, not globs: ${host}`);
  }
  if (!isPlausibleHostname(normalized)) {
    return sandboxFailure('invalid-request', `network host is not a valid hostname: ${host}`);
  }
  return sandboxSuccess(normalized);
}

export function normalizeSandboxNetworkHosts(
  entries: readonly string[],
): SandboxResult<readonly string[]> {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeSandboxNetworkHost(entry);
    if (!normalized.ok) return normalized;
    if (seen.has(normalized.value)) continue;
    seen.add(normalized.value);
    hosts.push(normalized.value);
  }
  return sandboxSuccess(hosts);
}

/** Normalizes one destination host. Looser than an allow entry: it accepts what a URL parser produces. */
function normalizeSandboxDestinationHost(host: string): SandboxResult<string> {
  if (typeof host !== 'string') {
    return sandboxFailure('invalid-request', 'destination host must be a string');
  }
  const normalized = stripTrailingDot(host.trim().toLowerCase());
  if (normalized.length === 0) {
    return sandboxFailure('invalid-request', 'destination host must be a non-empty hostname');
  }
  if (HOST_FORBIDDEN_CHARACTERS.test(normalized)) {
    return sandboxFailure('invalid-request', `destination host must be a bare hostname: ${host}`);
  }
  return sandboxSuccess(normalized);
}

function normalizeDestinationPort(port: number | undefined): SandboxResult<number | null> {
  if (port === undefined) return sandboxSuccess(null);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return sandboxFailure('invalid-request', `destination port must be an integer between 1 and 65535: ${String(port)}`);
  }
  return sandboxSuccess(port);
}

/**
 * Authorizes one destination against the egress policy. Fails with
 * `policy-denied` for denied destinations — no authorization value exists for
 * them, so downstream credential release is unreachable by construction.
 */
export function authorizeSandboxNetworkDestination(
  policy: SandboxNetworkPolicy,
  destination: SandboxNetworkDestination,
): SandboxResult<SandboxNetworkAuthorization> {
  const host = normalizeSandboxDestinationHost(destination.host);
  if (!host.ok) return host;
  const port = normalizeDestinationPort(destination.port);
  if (!port.ok) return port;

  if (policy.mode === 'denied') {
    return sandboxFailure(
      'policy-denied',
      `network egress to ${host.value} is denied by sandbox policy`,
    );
  }

  if (policy.mode === 'unrestricted') {
    return sandboxSuccess({ host: host.value, port: port.value, matchedHost: null, enforced: false });
  }

  const allowed = normalizeSandboxNetworkHosts(policy.allowedHosts ?? []);
  if (!allowed.ok) return allowed;
  if (allowed.value.length === 0) {
    return sandboxFailure(
      'invalid-request',
      'a restricted network policy must list at least one allowed host',
    );
  }
  const matched = allowed.value.find((entry) => entry === host.value);
  if (matched === undefined) {
    return sandboxFailure(
      'policy-denied',
      `network egress to ${host.value} is denied by sandbox policy: ` +
        `only ${allowed.value.join(', ')} may be reached`,
    );
  }
  return sandboxSuccess({ host: host.value, port: port.value, matchedHost: matched, enforced: true });
}

/** Parses a URL or a bare `host[:port]` into a destination. */
export function sandboxNetworkDestinationFromUrl(input: string): SandboxResult<SandboxNetworkDestination> {
  if (typeof input !== 'string' || input.trim().length === 0 || /[\0\n\r]/.test(input)) {
    return sandboxFailure('invalid-request', 'network destination must be a non-empty URL or host');
  }
  const trimmed = input.trim();
  if (trimmed.includes('://')) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return sandboxFailure('invalid-request', `network destination is not a valid URL: ${input}`);
    }
    if (url.hostname.length === 0) {
      return sandboxFailure('invalid-request', `network destination URL has no host: ${input}`);
    }
    const port = url.port === '' ? undefined : Number(url.port);
    return sandboxSuccess({ host: url.hostname, port });
  }
  const withoutPort = trimmed.lastIndexOf(':');
  if (withoutPort > -1) {
    const hostPart = trimmed.slice(0, withoutPort);
    const portPart = trimmed.slice(withoutPort + 1);
    if (hostPart.length === 0 || !/^\d{1,5}$/.test(portPart)) {
      return sandboxFailure('invalid-request', `network destination must be a host or host:port: ${input}`);
    }
    return sandboxSuccess({ host: hostPart, port: Number(portPart) });
  }
  return sandboxSuccess({ host: trimmed });
}

export interface SandboxNetworkProxyConfig {
  /** Proxy URL, e.g. `http://proxy.internal:3128`. Origin only; no embedded credentials. */
  readonly url: string;
}

/**
 * Validates a proxy URL and returns the normalized origin for the child env.
 * Embedded credentials are refused: a proxy URL lands in env vars and logs,
 * and proxy authentication belongs to the broker/transport, not a URL.
 */
export function normalizeSandboxNetworkProxy(config: SandboxNetworkProxyConfig): SandboxResult<string> {
  if (typeof config.url !== 'string' || config.url.trim().length === 0 || /[\0\n\r]/.test(config.url)) {
    return sandboxFailure('invalid-request', 'proxy url must be a non-empty string without NUL or newline characters');
  }
  let url: URL;
  try {
    url = new URL(config.url.trim());
  } catch {
    return sandboxFailure('invalid-request', `proxy url is not a valid URL: ${config.url}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return sandboxFailure('invalid-request', `proxy url must use http or https: ${config.url}`);
  }
  if (url.hostname.length === 0) {
    return sandboxFailure('invalid-request', `proxy url has no host: ${config.url}`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return sandboxFailure('invalid-request', 'proxy url must not embed credentials; route proxy authentication through the credential broker');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return sandboxFailure('invalid-request', `proxy url must be origin-only: ${config.url}`);
  }
  return sandboxSuccess(url.origin);
}

export interface SandboxNetworkEgressRequest {
  readonly policy: SandboxNetworkPolicy;
  readonly proxy?: SandboxNetworkProxyConfig;
  /**
   * The env the child would run with. `NO_PROXY`/`no_proxy` are removed from
   * it under a proxied plan so the child cannot bypass the proxy; pass the
   * real child env or the inherited values survive.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export type SandboxNetworkEgressPlan =
  | { readonly status: 'unrestricted' }
  | {
      readonly status: 'proxy-env';
      readonly proxyUrl: string;
      readonly proxyEnv: Readonly<Record<string, string>>;
      readonly removedEnvKeys: readonly string[];
      readonly allowedHosts: readonly string[];
    }
  | { readonly status: 'denied'; readonly reason: string };

/**
 * Projects the child env additions for the policy. `proxy-env` is advisory:
 * it routes children that honor proxy env vars and is not OS-level
 * enforcement, so a caller that must guarantee host confinement refuses
 * instead of running on it.
 */
export function resolveSandboxNetworkEgress(request: SandboxNetworkEgressRequest): SandboxNetworkEgressPlan {
  const mode = request.policy.mode;
  if (mode === 'unrestricted') return { status: 'unrestricted' };
  if (mode === 'denied') {
    return { status: 'denied', reason: 'network egress is denied by sandbox policy' };
  }

  const allowed = normalizeSandboxNetworkHosts(request.policy.allowedHosts ?? []);
  if (!allowed.ok) return { status: 'denied', reason: allowed.message };
  if (allowed.value.length === 0) {
    return { status: 'denied', reason: 'a restricted network policy must list at least one allowed host' };
  }
  if (request.proxy === undefined) {
    return {
      status: 'denied',
      reason:
        'a host-restricted network policy needs an egress proxy and none is configured; ' +
        'the runtime cannot confine a process to specific hosts without one',
    };
  }
  const proxyUrl = normalizeSandboxNetworkProxy(request.proxy);
  if (!proxyUrl.ok) return { status: 'denied', reason: proxyUrl.message };

  const proxyEnv: Record<string, string> = {
    HTTPS_PROXY: proxyUrl.value,
    HTTP_PROXY: proxyUrl.value,
    https_proxy: proxyUrl.value,
    http_proxy: proxyUrl.value,
  };
  const removedEnvKeys = Object.keys(request.env ?? {}).filter(
    (key) => key === 'NO_PROXY' || key === 'no_proxy',
  );
  return {
    status: 'proxy-env',
    proxyUrl: proxyUrl.value,
    proxyEnv,
    removedEnvKeys,
    allowedHosts: allowed.value,
  };
}

export interface SandboxNetworkCredential {
  /** Secret token name, matched verbatim by `$OMNICODE_SECRET_<id>` placeholders. */
  readonly id: string;
  /** Exact host this credential may be released to. */
  readonly host: string;
  readonly secret: string;
}

export interface SandboxCredentialRelease {
  readonly id: string;
  readonly host: string;
  readonly secret: string;
}

const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_]+$/;

export function normalizeSandboxNetworkCredentials(
  credentials: readonly SandboxNetworkCredential[],
): SandboxResult<readonly SandboxNetworkCredential[]> {
  const normalized: SandboxNetworkCredential[] = [];
  const seenIds = new Set<string>();
  for (const credential of credentials) {
    if (
      typeof credential.id !== 'string' ||
      !CREDENTIAL_ID_PATTERN.test(credential.id) ||
      typeof credential.secret !== 'string' ||
      credential.secret.length === 0
    ) {
      return sandboxFailure(
        'invalid-request',
        `credential must have an id of letters/digits/underscores and a non-empty secret: ${String(credential.id)}`,
      );
    }
    if (seenIds.has(credential.id)) {
      return sandboxFailure('invalid-request', `duplicate credential id: ${credential.id}`);
    }
    seenIds.add(credential.id);
    const host = normalizeSandboxNetworkHost(credential.host);
    if (!host.ok) return host;
    normalized.push({ id: credential.id, host: host.value, secret: credential.secret });
  }
  return sandboxSuccess(normalized);
}

/**
 * Releases credentials for an already-authorized destination. Only an
 * *enforced* authorization releases anything: an unrestricted policy cannot
 * scope a host-bound credential, so releasing under it would make the secret
 * reachable from any destination.
 */
export function selectSandboxCredentialsForAuthorization(
  authorization: SandboxNetworkAuthorization,
  credentials: readonly SandboxNetworkCredential[],
): readonly SandboxCredentialRelease[] {
  if (!authorization.enforced) return [];
  const releases: SandboxCredentialRelease[] = [];
  for (const credential of credentials) {
    const host = normalizeSandboxNetworkHost(credential.host);
    if (!host.ok) {
      throw new KaosValueError(`credential ${credential.id} has an invalid host: ${credential.host}`);
    }
    if (host.value !== authorization.host) continue;
    releases.push({ id: credential.id, host: host.value, secret: credential.secret });
  }
  return releases;
}

export interface SandboxCredentialBroker {
  /** Releases credentials for an already-authorized destination. */
  releaseFor(authorization: SandboxNetworkAuthorization): readonly SandboxCredentialRelease[];
}

/**
 * Broker over an in-memory credential set. Credential validation is
 * fail-fast: an invalid or duplicate credential is a composition error, not a
 * silent skip at release time.
 */
export function createMapCredentialBroker(
  credentials: readonly SandboxNetworkCredential[],
): SandboxCredentialBroker {
  const normalized = normalizeSandboxNetworkCredentials(credentials);
  if (!normalized.ok) throw new KaosValueError(normalized.message);
  return {
    releaseFor: (authorization) => selectSandboxCredentialsForAuthorization(authorization, normalized.value),
  };
}

const SECRET_TOKEN_PATTERN = /\$\{?OMNICODE_SECRET_([A-Za-z0-9_]+)\}?/g;

/**
 * Substitutes `$OMNICODE_SECRET_<id>` / `${OMNICODE_SECRET_<id>}` placeholders
 * with released credentials. Tokens without a release stay literal: an
 * unreleased placeholder is inert data, never silently dropped or emptied.
 */
export function substituteSandboxSecrets(
  value: string,
  releases: readonly SandboxCredentialRelease[],
): string {
  const byId = new Map(releases.map((release) => [release.id, release.secret]));
  return value.replace(SECRET_TOKEN_PATTERN, (token: string, id: string) => byId.get(id) ?? token);
}
