import { describe, expect, it } from 'vitest';

import {
  authorizeSandboxNetworkDestination,
  createMapCredentialBroker,
  normalizeSandboxNetworkCredentials,
  normalizeSandboxNetworkHosts,
  normalizeSandboxNetworkProxy,
  resolveSandboxNetworkEgress,
  sandboxNetworkDestinationFromUrl,
  selectSandboxCredentialsForAuthorization,
  substituteSandboxSecrets,
  type SandboxNetworkAuthorization,
  type SandboxNetworkCredential,
  type SandboxNetworkPolicy,
} from '#/sandbox/network';

function policy(overrides: Partial<SandboxNetworkPolicy> = {}): SandboxNetworkPolicy {
  return { mode: 'restricted', allowedHosts: ['api.example.com'], ...overrides };
}

function authorized(overrides: Partial<SandboxNetworkAuthorization> = {}): SandboxNetworkAuthorization {
  return { host: 'api.example.com', port: 443, matchedHost: 'api.example.com', enforced: true, ...overrides };
}

function credential(overrides: Partial<SandboxNetworkCredential> = {}): SandboxNetworkCredential {
  return { id: 'GITHUB_TOKEN', host: 'api.github.com', secret: 'gh-secret-value', ...overrides };
}

describe('normalizeSandboxNetworkHosts', () => {
  it('lowercases, trims, strips one trailing dot, and dedupes', () => {
    const hosts = normalizeSandboxNetworkHosts(['API.Example.com.', ' api.example.com ', 'GH.example.COM']);
    expect(hosts.ok).toBe(true);
    if (!hosts.ok) return;
    expect(hosts.value).toEqual(['api.example.com', 'gh.example.com']);
  });

  it('accepts single-label and IPv4-style hosts', () => {
    const hosts = normalizeSandboxNetworkHosts(['localhost', '127.0.0.1']);
    expect(hosts.ok && hosts.value).toEqual(['localhost', '127.0.0.1']);
  });

  it('rejects empty entries, wildcards, schemes, ports, and separators', () => {
    for (const entry of ['', '  ', '*.example.com', 'api.example.co*', 'https://api.example.com', 'api.example.com:443', 'api.example.com/x', 'user@api.example.com', 'api example.com']) {
      const hosts = normalizeSandboxNetworkHosts([entry]);
      expect(hosts.ok, entry).toBe(false);
    }
  });

  it('names the rejected entry in the failure', () => {
    const hosts = normalizeSandboxNetworkHosts(['api.example.com', '*.bad']);
    expect(hosts.ok).toBe(false);
    if (hosts.ok) return;
    expect(hosts.message).toContain('*.bad');
  });
});

describe('sandboxNetworkDestinationFromUrl', () => {
  it('parses scheme URLs with an explicit port', () => {
    const destination = sandboxNetworkDestinationFromUrl('https://api.example.com:8443/v1/x?y=1');
    expect(destination.ok && destination.value).toEqual({ host: 'api.example.com', port: 8443 });
  });

  it('omits the port when the URL carries none', () => {
    const destination = sandboxNetworkDestinationFromUrl('https://api.example.com');
    expect(destination.ok && destination.value).toEqual({ host: 'api.example.com', port: undefined });
  });

  it('parses bare hosts and host:port pairs', () => {
    expect(sandboxNetworkDestinationFromUrl('api.example.com').ok).toBe(true);
    const withPort = sandboxNetworkDestinationFromUrl('api.example.com:8080');
    expect(withPort.ok && withPort.value).toEqual({ host: 'api.example.com', port: 8080 });
  });

  it('rejects empty input, malformed pairs, and hostless URLs', () => {
    expect(sandboxNetworkDestinationFromUrl('').ok).toBe(false);
    expect(sandboxNetworkDestinationFromUrl('api.example.com:notaport').ok).toBe(false);
    expect(sandboxNetworkDestinationFromUrl('file:///tmp/x').ok).toBe(false);
  });
});

describe('authorizeSandboxNetworkDestination', () => {
  it('denies every destination under a denied policy', () => {
    const result = authorizeSandboxNetworkDestination({ mode: 'denied' }, { host: 'api.example.com' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('policy-denied');
    expect(result.message).toContain('api.example.com');
  });

  it('authorizes everything under an unrestricted policy without marking it enforced', () => {
    const result = authorizeSandboxNetworkDestination({ mode: 'unrestricted' }, { host: 'Evil.example.com.', port: 8080 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ host: 'evil.example.com', port: 8080, matchedHost: null, enforced: false });
  });

  it('authorizes a listed host under a restricted policy and records the matched entry', () => {
    const result = authorizeSandboxNetworkDestination(policy(), { host: 'API.example.com.' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      host: 'api.example.com',
      port: null,
      matchedHost: 'api.example.com',
      enforced: true,
    });
  });

  it('denies an unlisted host under a restricted policy and names the allowlist', () => {
    const result = authorizeSandboxNetworkDestination(policy(), { host: 'evil.example.com' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('policy-denied');
    expect(result.message).toContain('evil.example.com');
    expect(result.message).toContain('api.example.com');
  });

  it('refuses a restricted policy with no or invalid allow entries', () => {
    const empty = authorizeSandboxNetworkDestination({ mode: 'restricted', allowedHosts: [] }, { host: 'api.example.com' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('invalid-request');

    const missing = authorizeSandboxNetworkDestination({ mode: 'restricted' }, { host: 'api.example.com' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('invalid-request');

    const invalid = authorizeSandboxNetworkDestination(
      { mode: 'restricted', allowedHosts: ['*.wide'] },
      { host: 'api.example.com' },
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toContain('*.wide');
  });

  it('rejects out-of-range ports and empty destination hosts', () => {
    expect(authorizeSandboxNetworkDestination(policy(), { host: 'api.example.com', port: 0 }).ok).toBe(false);
    expect(authorizeSandboxNetworkDestination(policy(), { host: 'api.example.com', port: 70000 }).ok).toBe(false);
    expect(authorizeSandboxNetworkDestination(policy(), { host: '' }).ok).toBe(false);
  });
});

describe('resolveSandboxNetworkEgress', () => {
  it('leaves the child env untouched under an unrestricted policy', () => {
    const plan = resolveSandboxNetworkEgress({ policy: { mode: 'unrestricted' } });
    expect(plan).toEqual({ status: 'unrestricted' });
  });

  it('denies egress under a denied policy', () => {
    const plan = resolveSandboxNetworkEgress({ policy: { mode: 'denied' } });
    expect(plan.status).toBe('denied');
    if (plan.status === 'denied') expect(plan.reason).toContain('denied');
  });

  it('denies a restricted policy with no proxy instead of downgrading silently', () => {
    const plan = resolveSandboxNetworkEgress({ policy: policy() });
    expect(plan.status).toBe('denied');
    if (plan.status !== 'denied') return;
    expect(plan.reason).toContain('needs an egress proxy');
    expect(plan.reason).toContain('cannot confine');
  });

  it('denies a restricted policy whose allowlist is empty or invalid', () => {
    const empty = resolveSandboxNetworkEgress({ policy: { mode: 'restricted', allowedHosts: [] } });
    expect(empty.status).toBe('denied');
    const invalid = resolveSandboxNetworkEgress({ policy: { mode: 'restricted', allowedHosts: ['*.wide'] } });
    if (invalid.status === 'denied') expect(invalid.reason).toContain('*.wide');
    else expect.unreachable('invalid allowlist must deny');
  });

  it('projects proxy env and scrubs NO_PROXY bypasses under a proxied plan', () => {
    const plan = resolveSandboxNetworkEgress({
      policy: policy({ allowedHosts: ['api.example.com', 'GH.EXAMPLE.com'] }),
      proxy: { url: 'http://proxy.internal:3128' },
      env: { PATH: '/usr/bin', NO_PROXY: '*', no_proxy: 'localhost', HTTPS_PROXY: 'http://old' },
    });
    expect(plan.status).toBe('proxy-env');
    if (plan.status !== 'proxy-env') return;
    expect(plan.proxyUrl).toBe('http://proxy.internal:3128');
    expect(plan.proxyEnv).toEqual({
      HTTPS_PROXY: 'http://proxy.internal:3128',
      HTTP_PROXY: 'http://proxy.internal:3128',
      https_proxy: 'http://proxy.internal:3128',
      http_proxy: 'http://proxy.internal:3128',
    });
    expect(plan.removedEnvKeys).toEqual(['NO_PROXY', 'no_proxy']);
    expect(plan.allowedHosts).toEqual(['api.example.com', 'gh.example.com']);
  });

  it('reports no removed keys when the caller passed no env', () => {
    const plan = resolveSandboxNetworkEgress({ policy: policy(), proxy: { url: 'http://proxy.internal:3128' } });
    expect(plan.status).toBe('proxy-env');
    if (plan.status !== 'proxy-env') return;
    expect(plan.removedEnvKeys).toEqual([]);
  });

  it('denies when the proxy URL is unusable', () => {
    for (const url of ['ftp://proxy.internal:3128', 'http://user:pass@proxy.internal:3128', 'http://proxy.internal/x', 'not a url', '']) {
      const plan = resolveSandboxNetworkEgress({ policy: policy(), proxy: { url } });
      expect(plan.status, url).toBe('denied');
    }
  });
});

describe('credential broker', () => {
  it('normalizes credential hosts and refuses bad shapes, bad hosts, and duplicate ids', () => {
    const normalized = normalizeSandboxNetworkCredentials([
      credential({ host: 'API.GitHub.com.' }),
      credential({ id: 'OTHER', host: 'api.example.com', secret: 's2' }),
    ]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.map((entry) => entry.host)).toEqual(['api.github.com', 'api.example.com']);

    expect(normalizeSandboxNetworkCredentials([credential({ id: 'has space' })]).ok).toBe(false);
    expect(normalizeSandboxNetworkCredentials([credential({ secret: '' })]).ok).toBe(false);
    expect(normalizeSandboxNetworkCredentials([credential({ host: '*.wild' })]).ok).toBe(false);
    expect(
      normalizeSandboxNetworkCredentials([credential(), credential({ host: 'other.example.com' })]).ok,
    ).toBe(false);
  });

  it('releases only matching credentials for an enforced authorization', () => {
    const broker = createMapCredentialBroker([
      credential(),
      credential({ id: 'API_KEY', host: 'api.example.com', secret: 'api-secret' }),
    ]);
    const releases = broker.releaseFor(authorized());
    expect(releases).toEqual([{ id: 'API_KEY', host: 'api.example.com', secret: 'api-secret' }]);
  });

  it('releases nothing for a destination that was not authorized to a host restriction', () => {
    const broker = createMapCredentialBroker([credential({ host: 'api.example.com' })]);
    const unrestricted = broker.releaseFor(authorized({ enforced: false, matchedHost: null }));
    expect(unrestricted).toEqual([]);
    const otherHost = broker.releaseFor(authorized({ host: 'other.example.com' }));
    expect(otherHost).toEqual([]);
  });

  it('keeps secrets away from a denied destination end to end', () => {
    const broker = createMapCredentialBroker([credential({ host: 'api.example.com' })]);
    const denied = authorizeSandboxNetworkDestination(policy(), { host: 'evil.example.com' });
    expect(denied.ok).toBe(false);
    // A denied destination produces no authorization, so the only input the
    // substitution path can receive is an empty release set.
    const releases = denied.ok ? broker.releaseFor(denied.value) : [];
    expect(substituteSandboxSecrets('$OMNICODE_SECRET_GITHUB_TOKEN', releases)).toBe(
      '$OMNICODE_SECRET_GITHUB_TOKEN',
    );
  });

  it('throws on invalid credentials at broker construction instead of failing silently at release time', () => {
    expect(() => createMapCredentialBroker([credential({ host: 'not a host' })])).toThrow();
  });
});

describe('substituteSandboxSecrets', () => {
  it('substitutes released credentials in both placeholder forms', () => {
    const releases = [{ id: 'GITHUB_TOKEN', host: 'api.github.com', secret: 'gh-secret-value' }];
    expect(substituteSandboxSecrets('token: $OMNICODE_SECRET_GITHUB_TOKEN', releases)).toBe('token: gh-secret-value');
    expect(substituteSandboxSecrets('token: ${OMNICODE_SECRET_GITHUB_TOKEN}', releases)).toBe('token: gh-secret-value');
    expect(
      substituteSandboxSecrets('$OMNICODE_SECRET_GITHUB_TOKEN and again $OMNICODE_SECRET_GITHUB_TOKEN', releases),
    ).toBe('gh-secret-value and again gh-secret-value');
  });

  it('leaves placeholders without a release literal', () => {
    const releases = [{ id: 'GITHUB_TOKEN', host: 'api.github.com', secret: 'gh-secret-value' }];
    expect(substituteSandboxSecrets('$OMNICODE_SECRET_AWS_KEY', releases)).toBe('$OMNICODE_SECRET_AWS_KEY');
    expect(substituteSandboxSecrets('${OMNICODE_SECRET_AWS_KEY}tail', releases)).toBe('${OMNICODE_SECRET_AWS_KEY}tail');
    expect(substituteSandboxSecrets('no tokens here', releases)).toBe('no tokens here');
  });

  it('substitutes nothing when no credential was released', () => {
    expect(substituteSandboxSecrets('$OMNICODE_SECRET_GITHUB_TOKEN', [])).toBe('$OMNICODE_SECRET_GITHUB_TOKEN');
  });

  it('keeps unreleased placeholders intact while a released credential is substituted', () => {
    const releases = [{ id: 'GITHUB_TOKEN', host: 'api.github.com', secret: 'gh-secret-value' }];
    const value = 'curl -H "Authorization: Bearer $OMNICODE_SECRET_GITHUB_TOKEN" -H "X: $OMNICODE_SECRET_OTHER"';
    expect(substituteSandboxSecrets(value, releases)).toBe(
      'curl -H "Authorization: Bearer gh-secret-value" -H "X: $OMNICODE_SECRET_OTHER"',
    );
  });
});
