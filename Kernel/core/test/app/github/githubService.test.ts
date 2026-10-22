import { describe, expect, it, vi } from 'vitest';

import { GITHUB_SECTION } from '#/app/github/configSection';
import { GitHubCredentialStore, IGitHubCredentialStore } from '#/app/github/credentialStore';
import { GitHubDeviceFlowClient } from '#/app/github/deviceFlow';
import { GitHubService } from '#/app/github/githubService';
import { GitHubApiClient } from '#/app/github/httpClient';
import type { GitHubCredential, GitHubFetchImpl } from '#/app/github/types';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

import { StubConfigService } from '../../stubs';

const CLIENT_ID = 'Iv1.0a1b2c3d4e5f6g7h8';
const ACCESS_TOKEN = 'gho_0123456789abcdefghijklmnopqrstuvwxyz';
const DEVICE_CODE_ROUTE: FetchRoute = {
  pattern: 'login/device/code',
  respond: () =>
    jsonResponse({
      device_code: 'device-code-1',
      user_code: 'WDJB-MJHT',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }),
};

const USER_PAYLOAD = {
  login: 'octocat',
  id: 583231,
  name: 'The Octocat',
  html_url: 'https://github.com/octocat',
  type: 'User',
};

interface FetchRoute {
  readonly pattern: string;
  readonly respond: () => Response;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function createFetch(routes: readonly FetchRoute[]): GitHubFetchImpl {
  return vi.fn(async (input: string) => {
    for (const route of routes) {
      if (input.includes(route.pattern)) return route.respond();
    }
    return new Response('not found', { status: 404 });
  });
}

class FakeCredentialStore implements IGitHubCredentialStore {
  declare readonly _serviceBrand: undefined;

  readonly writes: GitHubCredential[] = [];
  cleared = 0;
  private credential: GitHubCredential | undefined;

  constructor(initial?: GitHubCredential) {
    this.credential = initial;
  }

  read(): Promise<GitHubCredential | undefined> {
    return Promise.resolve(this.credential);
  }

  write(credential: GitHubCredential): Promise<void> {
    this.credential = credential;
    this.writes.push(credential);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.cleared += 1;
    this.credential = undefined;
    return Promise.resolve();
  }
}

function connectedCredential(overrides: Partial<GitHubCredential> = {}): GitHubCredential {
  return {
    accessToken: ACCESS_TOKEN,
    tokenType: 'bearer',
    scopes: ['repo', 'workflow'],
    login: 'octocat',
    repositoryAccess: 'all',
    repositories: [],
    ...overrides,
  };
}

interface Harness {
  readonly service: GitHubService;
  readonly credentials: FakeCredentialStore;
  readonly config: StubConfigService;
  readonly fetchImpl: GitHubFetchImpl;
  readonly sleeps: number[];
}

function createHarness(
  routes: readonly FetchRoute[],
  options: {
    readonly config?: StubConfigService;
    readonly credentials?: FakeCredentialStore;
    readonly maxAttempts?: number;
  } = {},
): Harness {
  const config = options.config ?? new StubConfigService({});
  const credentials = options.credentials ?? new FakeCredentialStore();
  const fetchImpl = createFetch(routes);
  const sleeps: number[] = [];
  const clientOptions = {
    fetchImpl,
    maxAttempts: options.maxAttempts ?? 1,
    sleep: (delayMs: number) => {
      sleeps.push(delayMs);
      return Promise.resolve();
    },
  };
  const service = new GitHubService(
    new GitHubApiClient(clientOptions),
    new GitHubDeviceFlowClient(clientOptions),
    config,
    credentials,
  );
  return { service, credentials, config, fetchImpl, sleeps };
}

async function startFlow(harness: Harness): Promise<string> {
  const start = await harness.service.startDeviceFlow();
  return start.flowId;
}

function configuredConfig(section: Record<string, unknown> = {}): StubConfigService {
  return new StubConfigService({ [GITHUB_SECTION]: { clientId: CLIENT_ID, ...section } });
}

function fetchCalls(fetchImpl: GitHubFetchImpl): Array<[string, RequestInit | undefined]> {
  const mock = fetchImpl as unknown as {
    mock: { calls: Array<[string, RequestInit | undefined]> };
  };
  return mock.mock.calls;
}

describe('GitHubService status', () => {
  it('reports not configured and not connected without a client id', async () => {
    const harness = createHarness([]);

    const status = await harness.service.status();

    expect(status).toEqual({
      configured: false,
      connected: false,
      scopes: [],
      expired: false,
      repositoryAccess: 'none',
      repositories: [],
    });
  });

  it('reports connected with the account login, scopes, and expiry', async () => {
    const expiresAt = Date.now() + 3_600_000;
    const credentials = new FakeCredentialStore(
      connectedCredential({ expiresAt, scopes: ['repo', 'read:org'] }),
    );
    const harness = createHarness([], {
      config: configuredConfig(),
      credentials,
    });

    const status = await harness.service.status();

    expect(status).toMatchObject({
      configured: true,
      connected: true,
      accountLogin: 'octocat',
      scopes: ['repo', 'read:org'],
      expired: false,
      repositoryAccess: 'all',
    });
    expect(status.expiresAt).toBe(expiresAt);
  });

  it('never exposes token material in the status', async () => {
    const credentials = new FakeCredentialStore(
      connectedCredential({ refreshToken: 'ghr_0123456789abcdefghijklmnopqrstuvwxyz' }),
    );
    const harness = createHarness([], { credentials });

    const status = await harness.service.status();

    expect(JSON.stringify(status)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(status)).not.toContain('ghr_');
  });
});

describe('GitHubService device flow', () => {
  it('fails closed when no client id is configured', async () => {
    const harness = createHarness([]);

    await expect(harness.service.startDeviceFlow()).rejects.toMatchObject({
      code: 'github.not_configured',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('requests a device code with the configured client id and scopes', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'login/device/code',
          respond: () =>
            jsonResponse({
              device_code: 'device-code-1',
              user_code: 'WDJB-MJHT',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5,
            }),
        },
      ],
      { config: configuredConfig({ scopes: ['repo'] }) },
    );

    const start = await harness.service.startDeviceFlow();

    expect(start).toMatchObject({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
      intervalSeconds: 5,
      scopes: ['repo'],
    });
    expect(start.flowId).not.toBe('');
    expect(start).not.toHaveProperty('deviceCode');
    const [url, init] = fetchCalls(harness.fetchImpl)[0]!;
    expect(url).toBe('https://github.com/login/device/code');
    expect(init?.method).toBe('POST');
    const requestBody = typeof init?.body === 'string' ? init.body : '';
    expect(requestBody).toContain(`client_id=${CLIENT_ID}`);
    expect(requestBody).toContain('scope=repo');
  });

  it('persists the credential and reports the connected account after a successful poll', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () =>
            jsonResponse({
              access_token: ACCESS_TOKEN,
              token_type: 'bearer',
              scope: 'repo workflow',
              expires_in: 28800,
              repository_access: 2,
            }),
        },
        { pattern: 'api.github.com/user', respond: () => jsonResponse(USER_PAYLOAD) },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    const result = await harness.service.pollDeviceFlow(flowId);

    expect(result.kind).toBe('connected');
    expect(result.kind === 'connected' && result.status).toMatchObject({
      configured: true,
      connected: true,
      accountLogin: 'octocat',
      scopes: ['repo', 'workflow'],
      repositoryAccess: 'all',
    });
    expect(harness.credentials.writes).toHaveLength(1);
    expect(harness.credentials.writes[0]).toMatchObject({
      accessToken: ACCESS_TOKEN,
      login: 'octocat',
      scopes: ['repo', 'workflow'],
      repositoryAccess: 'all',
    });
    expect(harness.credentials.writes[0]?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('reports a pending poll without touching the credential store', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () => jsonResponse({ error: 'authorization_pending' }),
        },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    const result = await harness.service.pollDeviceFlow(flowId);

    expect(result).toEqual({ kind: 'pending' });
    expect(harness.credentials.writes).toHaveLength(0);
  });

  it('reports a slow-down poll', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () => jsonResponse({ error: 'slow_down' }),
        },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    expect(await harness.service.pollDeviceFlow(flowId)).toEqual({ kind: 'slow_down' });
  });

  it('clears the stored credential when GitHub rejects the freshly issued token', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () =>
            jsonResponse({
              access_token: ACCESS_TOKEN,
              token_type: 'bearer',
              scope: 'repo',
            }),
        },
        { pattern: 'api.github.com/user', respond: () => new Response('{}', { status: 401 }) },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    await expect(harness.service.pollDeviceFlow(flowId)).rejects.toMatchObject({
      code: 'github.token_revoked',
    });
    expect(harness.credentials.writes).toHaveLength(0);
    expect(harness.credentials.cleared).toBe(1);
  });

  it('fails with a denied error when the user denies the authorization', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () => jsonResponse({ error: 'access_denied' }),
        },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    await expect(harness.service.pollDeviceFlow(flowId)).rejects.toMatchObject({
      code: 'github.device_flow_denied',
    });
    expect(harness.credentials.writes).toHaveLength(0);
  });

  it('fails with an expired error when the device code expires', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () => jsonResponse({ error: 'expired_token' }),
        },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    await expect(harness.service.pollDeviceFlow(flowId)).rejects.toMatchObject({
      code: 'github.device_flow_expired',
    });
  });

  it('fails closed when the authorization request is unknown', async () => {
    const harness = createHarness([DEVICE_CODE_ROUTE], { config: configuredConfig() });

    await expect(harness.service.pollDeviceFlow('missing-flow')).rejects.toMatchObject({
      code: 'github.device_flow_not_found',
    });
  });

  it('fails with a device-flow error when GitHub rejects the request', async () => {
    const harness = createHarness(
      [
        DEVICE_CODE_ROUTE,
        {
          pattern: 'login/oauth/access_token',
          respond: () => jsonResponse({ error: 'incorrect_device_code' }, { status: 400 }),
        },
      ],
      { config: configuredConfig() },
    );

    const flowId = await startFlow(harness);
    await expect(harness.service.pollDeviceFlow(flowId)).rejects.toMatchObject({
      code: 'github.device_flow_failed',
    });
  });
});

describe('GitHubService disconnect', () => {
  it('clears the local credential and reports that the provider grant stays active', async () => {
    const credentials = new FakeCredentialStore(connectedCredential());
    const harness = createHarness([], { credentials });

    const result = await harness.service.disconnect();

    expect(result.disconnected).toBe(true);
    expect(result.providerRevoked).toBe(false);
    expect(result.message).toContain('revoked in the GitHub account settings');
    expect(credentials.cleared).toBe(1);
    expect((await harness.service.status()).connected).toBe(false);
  });

  it('reports nothing to disconnect when no credential is stored', async () => {
    const harness = createHarness([]);

    const result = await harness.service.disconnect();

    expect(result.disconnected).toBe(false);
    expect(result.providerRevoked).toBe(false);
  });
});

describe('GitHubService read operations', () => {
  it('lists repositories for the authenticated account', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com/user/repos',
          respond: () =>
            jsonResponse([
              {
                id: 1,
                name: 'hello-world',
                full_name: 'octocat/hello-world',
                private: false,
                html_url: 'https://github.com/octocat/hello-world',
                default_branch: 'main',
                description: 'My first repository',
              },
            ]),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const repositories = await harness.service.listRepositories({ limit: 5 });

    expect(repositories).toEqual([
      {
        id: 1,
        name: 'hello-world',
        fullName: 'octocat/hello-world',
        private: false,
        htmlUrl: 'https://github.com/octocat/hello-world',
        defaultBranch: 'main',
        description: 'My first repository',
      },
    ]);
    const [url] = fetchCalls(harness.fetchImpl)[0]!;
    expect(url).toBe('https://api.github.com/user/repos?per_page=5&sort=updated');
  });

  it('reads the authenticated user', async () => {
    const harness = createHarness(
      [{ pattern: 'api.github.com/user', respond: () => jsonResponse(USER_PAYLOAD) }],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const user = await harness.service.getAuthenticatedUser();

    expect(user).toEqual({
      login: 'octocat',
      id: 583231,
      name: 'The Octocat',
      htmlUrl: 'https://github.com/octocat',
      type: 'User',
    });
  });

  it('lists issues of a repository', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com/repos/octocat/hello-world/issues',
          respond: () =>
            jsonResponse([
              {
                number: 7,
                title: 'Found a bug',
                state: 'open',
                html_url: 'https://github.com/octocat/hello-world/issues/7',
                user: { login: 'octocat' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-02T00:00:00Z',
                labels: [{ name: 'bug' }],
              },
            ]),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const issues = await harness.service.listIssues('octocat/hello-world', { state: 'all' });

    expect(issues[0]).toMatchObject({
      number: 7,
      title: 'Found a bug',
      state: 'open',
      author: 'octocat',
      labels: ['bug'],
      isPullRequest: false,
    });
    const [url] = fetchCalls(harness.fetchImpl)[0]!;
    expect(url).toBe(
      'https://api.github.com/repos/octocat/hello-world/issues?per_page=30&state=all',
    );
  });

  it('lists pull requests of a repository', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com/repos/octocat/hello-world/pulls',
          respond: () =>
            jsonResponse([
              {
                number: 3,
                title: 'Fix the readme',
                state: 'open',
                draft: false,
                html_url: 'https://github.com/octocat/hello-world/pull/3',
                user: { login: 'hubot' },
                created_at: '2024-02-01T00:00:00Z',
                updated_at: '2024-02-02T00:00:00Z',
                head: { ref: 'fix-readme' },
                base: { ref: 'main' },
              },
            ]),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const pullRequests = await harness.service.listPullRequests('octocat/hello-world');

    expect(pullRequests[0]).toMatchObject({
      number: 3,
      title: 'Fix the readme',
      author: 'hubot',
      headRef: 'fix-readme',
      baseRef: 'main',
      draft: false,
    });
  });

  it('reads one pull request with its change size', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com/repos/octocat/hello-world/pulls/3',
          respond: () =>
            jsonResponse({
              number: 3,
              title: 'Fix the readme',
              state: 'closed',
              draft: false,
              merged: true,
              mergeable: null,
              additions: 12,
              deletions: 4,
              changed_files: 2,
              commits: 1,
              body: 'Fixes the typo.',
              html_url: 'https://github.com/octocat/hello-world/pull/3',
              user: { login: 'hubot' },
              created_at: '2024-02-01T00:00:00Z',
              updated_at: '2024-02-02T00:00:00Z',
              head: { ref: 'fix-readme' },
              base: { ref: 'main' },
            }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const pullRequest = await harness.service.getPullRequest('octocat/hello-world', 3);

    expect(pullRequest).toMatchObject({
      number: 3,
      merged: true,
      mergeable: undefined,
      additions: 12,
      deletions: 4,
      changedFiles: 2,
      commits: 1,
      body: 'Fixes the typo.',
    });
  });

  it('lists workflow runs of a repository', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com/repos/octocat/hello-world/actions/runs',
          respond: () =>
            jsonResponse({
              workflow_runs: [
                {
                  id: 99,
                  name: 'build',
                  status: 'completed',
                  conclusion: 'failure',
                  event: 'push',
                  html_url: 'https://github.com/octocat/hello-world/actions/runs/99',
                  head_branch: 'main',
                  head_sha: 'abc123',
                  created_at: '2024-03-01T00:00:00Z',
                  updated_at: '2024-03-01T00:05:00Z',
                },
              ],
            }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const runs = await harness.service.listWorkflowRuns('octocat/hello-world');

    expect(runs[0]).toMatchObject({
      id: 99,
      name: 'build',
      status: 'completed',
      conclusion: 'failure',
      event: 'push',
      headBranch: 'main',
      headSha: 'abc123',
    });
  });

  it('rejects a malformed repository name before calling GitHub', async () => {
    const harness = createHarness([], {
      credentials: new FakeCredentialStore(connectedCredential()),
    });

    await expect(harness.service.listIssues('not-a-repository')).rejects.toMatchObject({
      code: 'github.invalid_repository',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });
});

describe('GitHubService authorization failures', () => {
  it('fails closed when no account is connected', async () => {
    const harness = createHarness([]);

    await expect(harness.service.listRepositories()).rejects.toMatchObject({
      code: 'github.not_connected',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('fails closed when the stored authorization expired', async () => {
    const harness = createHarness([], {
      credentials: new FakeCredentialStore(connectedCredential({ expiresAt: Date.now() - 1_000 })),
    });

    await expect(harness.service.listRepositories()).rejects.toMatchObject({
      code: 'github.token_expired',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('clears the stored credential when GitHub rejects the token', async () => {
    const credentials = new FakeCredentialStore(connectedCredential());
    const harness = createHarness(
      [{ pattern: 'api.github.com', respond: () => new Response('{}', { status: 401 }) }],
      { credentials },
    );

    await expect(harness.service.listRepositories()).rejects.toMatchObject({
      code: 'github.token_revoked',
    });
    expect(credentials.cleared).toBe(1);
    expect((await harness.service.status()).connected).toBe(false);
  });

  it('fails closed when the granted scopes do not cover the operation', async () => {
    const harness = createHarness([], {
      credentials: new FakeCredentialStore(connectedCredential({ scopes: ['public_repo'] })),
    });

    await expect(harness.service.listWorkflowRuns('octocat/hello-world')).rejects.toMatchObject({
      code: 'github.scope_denied',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('rejects a repository outside the granted repository set', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com/repos/',
          respond: () => jsonResponse([]),
        },
      ],
      {
        credentials: new FakeCredentialStore(
          connectedCredential({
            repositoryAccess: 'selected',
            repositories: ['acme/allowed'],
          }),
        ),
      },
    );

    await expect(harness.service.listIssues('octocat/hello-world')).rejects.toMatchObject({
      code: 'github.scope_denied',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);

    await expect(harness.service.listIssues('acme/allowed')).resolves.toEqual([]);
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(1);
  });
});

describe('GitHubService rate limits', () => {
  it('reports a rate limit when the primary limit is exhausted', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com',
          respond: () =>
            new Response('{}', {
              status: 403,
              headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' },
            }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    await expect(harness.service.listRepositories()).rejects.toMatchObject({
      code: 'github.rate_limited',
    });
  });

  it('retries after the Retry-After window and succeeds', async () => {
    let calls = 0;
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com',
          respond: () => {
            calls += 1;
            if (calls === 1) {
              return new Response('{}', {
                status: 429,
                headers: { 'retry-after': '2' },
              });
            }
            return jsonResponse([]);
          },
        },
      ],
      {
        credentials: new FakeCredentialStore(connectedCredential()),
        maxAttempts: 3,
      },
    );

    const repositories = await harness.service.listRepositories();

    expect(repositories).toEqual([]);
    expect(calls).toBe(2);
    expect(harness.sleeps).toEqual([2000]);
  });

  it('gives up after the bounded retry budget', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.github.com',
          respond: () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
        },
      ],
      {
        credentials: new FakeCredentialStore(connectedCredential()),
        maxAttempts: 2,
      },
    );

    await expect(harness.service.listRepositories()).rejects.toMatchObject({
      code: 'github.rate_limited',
    });
    expect(harness.sleeps).toEqual([1000]);
  });
});

describe('GitHubCredentialStore', () => {
  it('persists the credential under the credentials/github scope', async () => {
    const writes: Array<[string, string, unknown]> = [];
    const store = new StubAtomicDocumentStore(writes);
    const credentialStore = new GitHubCredentialStore(store);
    const credential = connectedCredential();

    await credentialStore.write(credential);

    expect(writes).toEqual([['credentials/github', 'account', credential]]);
    expect(await credentialStore.read()).toEqual(credential);

    await credentialStore.clear();

    expect(store.deleted).toEqual([['credentials/github', 'account']]);
  });
});

class StubAtomicDocumentStore implements IAtomicDocumentStore {
  declare readonly _serviceBrand: undefined;

  readonly deleted: Array<[string, string]> = [];
  private readonly values = new Map<string, unknown>();

  constructor(private readonly writes: Array<[string, string, unknown]>) {}

  get<T>(scope: string, key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(`${scope}/${key}`) as T | undefined);
  }

  set<T>(scope: string, key: string, value: T): Promise<void> {
    this.writes.push([scope, key, value]);
    this.values.set(`${scope}/${key}`, value);
    return Promise.resolve();
  }

  delete(scope: string, key: string): Promise<void> {
    this.deleted.push([scope, key]);
    this.values.delete(`${scope}/${key}`);
    return Promise.resolve();
  }

  list(scope: string, prefix?: string): Promise<readonly string[]> {
    const entries = [...this.values.keys()]
      .filter((entry) => entry.startsWith(`${scope}/`))
      .map((entry) => entry.slice(scope.length + 1))
      .filter((entry) => prefix === undefined || entry.startsWith(prefix));
    return Promise.resolve(entries);
  }

  acquire(): { dispose(): void } {
    return { dispose: () => {} };
  }
}

describe('GitHubApiClient', () => {
  it('does not retry a request whose caller signal was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response('{}', { status: 200 });
    });
    const client = new GitHubApiClient({
      fetchImpl,
      maxAttempts: 3,
      sleep: () => Promise.resolve(),
    });

    await expect(client.request({ path: '/user', signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer token and the GitHub API version header', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new GitHubApiClient({ fetchImpl, maxAttempts: 1 });

    await client.request({ path: '/user', token: ACCESS_TOKEN });

    const [, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } })
      .mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers['x-github-api-version']).toBe('2022-11-28');
  });
});
