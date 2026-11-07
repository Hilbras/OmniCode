import { describe, expect, it, vi } from 'vitest';

import { VERCEL_SECTION } from '#/app/vercel/configSection';
import {
  VERCEL_CREDENTIAL_KEY,
  VERCEL_CREDENTIALS_SCOPE,
  VercelCredentialStore,
} from '#/app/vercel/credentialStore';
import { VercelApiClient } from '#/app/vercel/httpClient';
import type { VercelCredential, VercelFetchImpl } from '#/app/vercel/types';
import { VercelService } from '#/app/vercel/vercelService';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

import { StubConfigService } from '../../stubs';

const ACCESS_TOKEN = 'AbCdEf0123456789ghijklmn';
const USER_ID = 'user_1';
const TEAM_ID = 'team_1';

const USER_PAYLOAD = {
  user: {
    id: USER_ID,
    username: 'ada',
    email: 'ada@example.test',
    name: 'Ada Lovelace',
    defaultTeamId: TEAM_ID,
  },
};

const TEAMS_PAYLOAD = {
  teams: [{ id: TEAM_ID, slug: 'acme', name: 'Acme Inc' }],
};

const PROJECT_PAYLOAD = {
  id: 'prj_1',
  name: 'my-app',
  accountId: TEAM_ID,
  framework: 'nextjs',
  nodeVersion: '20',
};

const DEPLOYMENT_PAYLOAD = {
  id: 'dpl_1',
  name: 'my-app',
  projectId: 'prj_1',
  target: 'production',
  readyState: 'ERROR',
  url: 'my-app-acme.vercel.app',
  alias: ['my-app-acme.vercel.app'],
  createdAt: 1_700_000_000_000,
  errorCode: 'BUILD_FAILED',
  errorMessage: 'Command "npm run build" failed.',
  source: 'cli',
  ownerId: USER_ID,
  team: { id: TEAM_ID, slug: 'acme', name: 'Acme Inc' },
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

function createFetch(routes: readonly FetchRoute[]): VercelFetchImpl {
  return vi.fn(async (input: string) => {
    for (const route of routes) {
      if (input.includes(route.pattern)) return route.respond();
    }
    return new Response('not found', { status: 404 });
  });
}

class FakeCredentialStore {
  declare readonly _serviceBrand: undefined;

  readonly writes: VercelCredential[] = [];
  cleared = 0;
  private credential: VercelCredential | undefined;

  constructor(initial?: VercelCredential) {
    this.credential = initial;
  }

  read(): Promise<VercelCredential | undefined> {
    return Promise.resolve(this.credential);
  }

  write(credential: VercelCredential): Promise<void> {
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

function connectedCredential(overrides: Partial<VercelCredential> = {}): VercelCredential {
  return {
    accessToken: ACCESS_TOKEN,
    userId: USER_ID,
    username: 'ada',
    scope: { type: 'team', id: TEAM_ID, slug: 'acme', name: 'Acme Inc' },
    accounts: [
      { id: USER_ID, type: 'user', slug: 'ada', name: 'Ada Lovelace' },
      { id: TEAM_ID, type: 'team', slug: 'acme', name: 'Acme Inc' },
    ],
    scopes: ['user', 'team'],
    ...overrides,
  };
}

interface Harness {
  readonly service: VercelService;
  readonly credentials: FakeCredentialStore;
  readonly config: StubConfigService;
  readonly fetchImpl: VercelFetchImpl;
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
  const service = new VercelService(
    new VercelApiClient({
      fetchImpl,
      maxAttempts: options.maxAttempts ?? 1,
      sleep: (delayMs: number) => {
        sleeps.push(delayMs);
        return Promise.resolve();
      },
    }),
    config,
    credentials,
  );
  return { service, credentials, config, fetchImpl, sleeps };
}

function configuredConfig(section: Record<string, unknown> = {}): StubConfigService {
  return new StubConfigService({ [VERCEL_SECTION]: { token: ACCESS_TOKEN, ...section } });
}

function fetchCalls(fetchImpl: VercelFetchImpl): Array<[string, RequestInit | undefined]> {
  const mock = fetchImpl as unknown as {
    mock: { calls: Array<[string, RequestInit | undefined]> };
  };
  return mock.mock.calls;
}

function urls(fetchImpl: VercelFetchImpl): string[] {
  return fetchCalls(fetchImpl).map(([url]) => url);
}

const AUTH_ROUTES: readonly FetchRoute[] = [
  { pattern: '/v2/user', respond: () => jsonResponse(USER_PAYLOAD) },
  { pattern: '/v2/teams', respond: () => jsonResponse(TEAMS_PAYLOAD) },
];

describe('VercelService status', () => {
  it('reports not configured and not connected without a token', async () => {
    const harness = createHarness([]);

    const status = await harness.service.status();

    expect(status).toEqual({
      configured: false,
      connected: false,
      scopes: [],
      expired: false,
    });
  });

  it('reports configured but not connected when only a config token exists', async () => {
    const harness = createHarness([], { config: configuredConfig() });

    const status = await harness.service.status();

    expect(status).toMatchObject({ configured: true, connected: false });
  });

  it('reports the account identity and scopes of a stored credential', async () => {
    const credentials = new FakeCredentialStore(connectedCredential());
    const harness = createHarness([], { credentials });

    const status = await harness.service.status();

    expect(status).toMatchObject({
      configured: true,
      connected: true,
      accountId: TEAM_ID,
      accountType: 'team',
      accountSlug: 'acme',
      accountName: 'Acme Inc',
      username: 'ada',
      scopes: ['user', 'team'],
      expired: false,
    });
  });

  it('never exposes token material in the status', async () => {
    const credentials = new FakeCredentialStore(connectedCredential());
    const harness = createHarness([], { credentials });

    const status = await harness.service.status();

    expect(JSON.stringify(status)).not.toContain(ACCESS_TOKEN);
  });

  it('never exposes token material that Vercel echoes in a response', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        {
          pattern: '/v13/deployments/dpl_1',
          respond: () =>
            jsonResponse({
              ...DEPLOYMENT_PAYLOAD,
              errorMessage: `Build failed for token ${ACCESS_TOKEN}`,
            }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const deployment = await harness.service.getDeployment('dpl_1');

    expect(deployment.errorMessage).toBe('Build failed for token [REDACTED]');
    expect(JSON.stringify(deployment)).not.toContain(ACCESS_TOKEN);
  });
});

describe('VercelService connect', () => {
  it('stores the credential and resolves the account of the token', async () => {
    const harness = createHarness(AUTH_ROUTES);

    const result = await harness.service.connect(ACCESS_TOKEN);

    expect(result.connected).toBe(true);
    expect(result.status).toMatchObject({
      configured: true,
      connected: true,
      accountId: TEAM_ID,
      accountType: 'team',
      accountSlug: 'acme',
      username: 'ada',
      scopes: ['user', 'team'],
    });
    expect(harness.credentials.writes).toHaveLength(1);
    expect(harness.credentials.writes[0]).toMatchObject({
      accessToken: ACCESS_TOKEN,
      userId: USER_ID,
      username: 'ada',
      scope: { type: 'team', id: TEAM_ID, slug: 'acme' },
    });
    expect(result.message).toContain('acme');
  });

  it('refuses an empty token without calling Vercel', async () => {
    const harness = createHarness([]);

    await expect(harness.service.connect('   ')).rejects.toMatchObject({
      code: 'vercel.not_configured',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('connects with the configured token when no token is passed', async () => {
    const harness = createHarness(AUTH_ROUTES, { config: configuredConfig() });

    const result = await harness.service.connect();

    expect(result.connected).toBe(true);
    expect(result.status).toMatchObject({ accountId: TEAM_ID, accountType: 'team' });
    expect(harness.credentials.writes[0]).toMatchObject({ accessToken: ACCESS_TOKEN });
  });

  it('fails closed when no token is configured at all', async () => {
    const harness = createHarness([]);

    await expect(harness.service.connect()).rejects.toMatchObject({
      code: 'vercel.not_configured',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('clears the stored credential when Vercel rejects the token', async () => {
    const harness = createHarness([
      { pattern: '/v2/user', respond: () => new Response('{}', { status: 401 }) },
    ]);

    await expect(harness.service.connect(ACCESS_TOKEN)).rejects.toMatchObject({
      code: 'vercel.token_invalid',
    });
    expect(harness.credentials.writes).toHaveLength(0);
  });

  it('denies a configured team the token cannot reach', async () => {
    const harness = createHarness(AUTH_ROUTES, {
      config: new StubConfigService({ [VERCEL_SECTION]: { teamId: 'team_other' } }),
    });

    await expect(harness.service.connect(ACCESS_TOKEN)).rejects.toMatchObject({
      code: 'vercel.scope_denied',
    });
    expect(harness.credentials.writes).toHaveLength(0);
  });

  it('removes the stored credential on disconnect', async () => {
    const credentials = new FakeCredentialStore(connectedCredential());
    const harness = createHarness([], { credentials });

    const result = await harness.service.disconnect();

    expect(result.disconnected).toBe(true);
    expect(credentials.cleared).toBe(1);
    expect((await harness.service.status()).connected).toBe(false);
  });

  it('reports nothing to disconnect when no credential is stored', async () => {
    const harness = createHarness([]);

    const result = await harness.service.disconnect();

    expect(result.disconnected).toBe(false);
  });
});

describe('VercelService read operations', () => {
  it('lists the projects of the authorized account', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        { pattern: '/v10/projects', respond: () => jsonResponse([PROJECT_PAYLOAD]) },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const projects = await harness.service.listProjects({ limit: 5 });

    expect(projects).toEqual([
      {
        id: 'prj_1',
        name: 'my-app',
        accountId: TEAM_ID,
        framework: 'nextjs',
        nodeVersion: '20',
        createdAt: undefined,
        updatedAt: undefined,
        url: 'https://vercel.com/acme/my-app',
      },
    ]);
    expect(urls(harness.fetchImpl)).toEqual([
      'https://api.vercel.com/v10/projects?limit=5&teamId=team_1',
    ]);
  });

  it('lists the deployments of a project', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        { pattern: '/v9/projects/my-app', respond: () => jsonResponse(PROJECT_PAYLOAD) },
        {
          pattern: '/v7/deployments',
          respond: () =>
            jsonResponse({
              deployments: [
                {
                  uid: 'dpl_1',
                  name: 'my-app',
                  projectId: 'prj_1',
                  target: 'production',
                  state: 'READY',
                  url: 'my-app-acme.vercel.app',
                  alias: ['my-app-acme.vercel.app'],
                  createdAt: 1_700_000_000_000,
                },
              ],
            }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const deployments = await harness.service.listDeployments('my-app', { limit: 10 });

    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({
      id: 'dpl_1',
      name: 'my-app',
      projectId: 'prj_1',
      target: 'production',
      state: 'READY',
      alias: ['my-app-acme.vercel.app'],
    });
    expect(urls(harness.fetchImpl)).toEqual([
      'https://api.vercel.com/v9/projects/my-app',
      'https://api.vercel.com/v7/deployments?projectId=prj_1&limit=10',
    ]);
  });

  it('reads one deployment', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        {
          pattern: '/v13/deployments/dpl_1',
          respond: () => jsonResponse(DEPLOYMENT_PAYLOAD),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const deployment = await harness.service.getDeployment('dpl_1');

    expect(deployment).toMatchObject({
      id: 'dpl_1',
      name: 'my-app',
      projectId: 'prj_1',
      accountId: TEAM_ID,
      target: 'production',
      state: 'ERROR',
      errorCode: 'BUILD_FAILED',
      errorMessage: 'Command "npm run build" failed.',
      source: 'cli',
    });
  });

  it('reads the build logs of a deployment', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        { pattern: '/v13/deployments/dpl_1', respond: () => jsonResponse(DEPLOYMENT_PAYLOAD) },
        {
          pattern: '/v3/deployments/dpl_1/events',
          respond: () =>
            jsonResponse([
              { type: 'stdout', text: 'Running build in acme/my-app', created: 1_700_000_000_000 },
              { type: 'stderr', text: 'Error: build failed', created: 1_700_000_005_000 },
            ]),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const events = await harness.service.getDeploymentEvents('dpl_1', { limit: 20 });

    expect(events).toEqual([
      {
        type: 'stdout',
        text: 'Running build in acme/my-app',
        level: undefined,
        createdAt: 1_700_000_000_000,
      },
      {
        type: 'stderr',
        text: 'Error: build failed',
        level: undefined,
        createdAt: 1_700_000_005_000,
      },
    ]);
    expect(urls(harness.fetchImpl)).toEqual([
      'https://api.vercel.com/v13/deployments/dpl_1',
      'https://api.vercel.com/v3/deployments/dpl_1/events?limit=20&builds=1',
    ]);
  });

  it('reads the authenticated account', async () => {
    const harness = createHarness(
      [...AUTH_ROUTES, { pattern: '/v2/user', respond: () => jsonResponse(USER_PAYLOAD) }],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const user = await harness.service.getAuthenticatedUser();

    expect(user).toEqual({
      id: USER_ID,
      username: 'ada',
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      defaultTeamId: TEAM_ID,
    });
  });

  it('resolves the account of a token that only exists in the configuration', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        { pattern: '/v10/projects', respond: () => jsonResponse([PROJECT_PAYLOAD]) },
      ],
      { config: configuredConfig() },
    );

    const projects = await harness.service.listProjects();

    expect(projects).toHaveLength(1);
    expect(urls(harness.fetchImpl)).toEqual([
      'https://api.vercel.com/v2/user',
      'https://api.vercel.com/v2/teams?limit=100',
      'https://api.vercel.com/v10/projects?limit=30&teamId=team_1',
    ]);
    expect(harness.credentials.writes).toHaveLength(0);
  });
});

describe('VercelService authorization failures', () => {
  it('fails closed when no token is configured', async () => {
    const harness = createHarness([]);

    await expect(harness.service.listProjects()).rejects.toMatchObject({
      code: 'vercel.not_configured',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('fails closed when the stored token expired', async () => {
    const harness = createHarness([], {
      credentials: new FakeCredentialStore(connectedCredential({ expiresAt: Date.now() - 1_000 })),
    });

    await expect(harness.service.listProjects()).rejects.toMatchObject({
      code: 'vercel.token_expired',
    });
    expect(fetchCalls(harness.fetchImpl)).toHaveLength(0);
  });

  it('clears the stored credential when Vercel rejects the token', async () => {
    const credentials = new FakeCredentialStore(connectedCredential());
    const harness = createHarness(
      [{ pattern: 'api.vercel.com', respond: () => new Response('{}', { status: 401 }) }],
      { credentials },
    );

    await expect(harness.service.listProjects()).rejects.toMatchObject({
      code: 'vercel.token_invalid',
    });
    expect(credentials.cleared).toBe(1);
    expect((await harness.service.status()).connected).toBe(false);
  });

  it('never echoes the token in an error message', async () => {
    const harness = createHarness(
      [{ pattern: 'api.vercel.com', respond: () => new Response('{}', { status: 401 }) }],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    const error = await harness.service.listProjects().catch((error: unknown) => error);

    expect((error as Error).message).not.toContain(ACCESS_TOKEN);
  });

  it('denies a project outside the authorized account', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        {
          pattern: '/v9/projects/other-app',
          respond: () => jsonResponse({ ...PROJECT_PAYLOAD, id: 'prj_2', accountId: 'team_other' }),
        },
        { pattern: '/v7/deployments', respond: () => jsonResponse({ deployments: [] }) },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    await expect(harness.service.listDeployments('other-app')).rejects.toMatchObject({
      code: 'vercel.scope_denied',
    });
    expect(urls(harness.fetchImpl)).toEqual(['https://api.vercel.com/v9/projects/other-app']);
  });

  it('denies a deployment outside the authorized account', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        {
          pattern: '/v13/deployments/dpl_9',
          respond: () =>
            jsonResponse({
              ...DEPLOYMENT_PAYLOAD,
              id: 'dpl_9',
              team: { id: 'team_other', slug: 'other', name: 'Other Inc' },
            }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    await expect(harness.service.getDeployment('dpl_9')).rejects.toMatchObject({
      code: 'vercel.scope_denied',
    });
  });

  it('denies a project list that contains a project outside the authorized account', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        {
          pattern: '/v10/projects',
          respond: () =>
            jsonResponse([
              PROJECT_PAYLOAD,
              { ...PROJECT_PAYLOAD, id: 'prj_2', accountId: 'team_other' },
            ]),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    await expect(harness.service.listProjects()).rejects.toMatchObject({
      code: 'vercel.scope_denied',
    });
  });

  it('reports a missing resource without leaking the token', async () => {
    const harness = createHarness(
      [
        ...AUTH_ROUTES,
        {
          pattern: '/v13/deployments/',
          respond: () => new Response('{}', { status: 404 }),
        },
      ],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    await expect(harness.service.getDeployment('dpl_missing')).rejects.toMatchObject({
      code: 'vercel.not_found',
    });
  });
});

describe('VercelService rate limits', () => {
  it('retries after the Retry-After window and succeeds', async () => {
    let calls = 0;
    const harness = createHarness(
      [
        {
          pattern: 'api.vercel.com',
          respond: () => {
            calls += 1;
            if (calls === 1) {
              return new Response('{}', { status: 429, headers: { 'retry-after': '2' } });
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

    const projects = await harness.service.listProjects();

    expect(projects).toEqual([]);
    expect(calls).toBe(2);
    expect(harness.sleeps).toEqual([2000]);
  });

  it('gives up after the bounded retry budget', async () => {
    const harness = createHarness(
      [
        {
          pattern: 'api.vercel.com',
          respond: () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
        },
      ],
      {
        credentials: new FakeCredentialStore(connectedCredential()),
        maxAttempts: 2,
      },
    );

    await expect(harness.service.listProjects()).rejects.toMatchObject({
      code: 'vercel.rate_limited',
    });
    expect(harness.sleeps).toEqual([1000]);
  });

  it('reports a forbidden request that is not a rate limit', async () => {
    const harness = createHarness(
      [{ pattern: 'api.vercel.com', respond: () => new Response('{}', { status: 403 }) }],
      { credentials: new FakeCredentialStore(connectedCredential()) },
    );

    await expect(harness.service.listProjects()).rejects.toMatchObject({
      code: 'vercel.forbidden',
    });
  });
});

describe('VercelCredentialStore', () => {
  it('persists the credential under the credentials/vercel scope', async () => {
    const writes: Array<[string, string, unknown]> = [];
    const store = new StubAtomicDocumentStore(writes);
    const credentialStore = new VercelCredentialStore(store);
    const credential = connectedCredential();

    await credentialStore.write(credential);

    expect(writes).toEqual([[VERCEL_CREDENTIALS_SCOPE, VERCEL_CREDENTIAL_KEY, credential]]);
    expect(await credentialStore.read()).toEqual(credential);

    await credentialStore.clear();

    expect(store.deleted).toEqual([[VERCEL_CREDENTIALS_SCOPE, VERCEL_CREDENTIAL_KEY]]);
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

describe('VercelApiClient', () => {
  it('does not retry a request whose caller signal was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response('{}', { status: 200 });
    });
    const client = new VercelApiClient({
      fetchImpl,
      maxAttempts: 3,
      sleep: () => Promise.resolve(),
    });

    await expect(client.request({ path: '/v2/user', signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new VercelApiClient({ fetchImpl, maxAttempts: 1 });

    await client.request({ path: '/v2/user', token: ACCESS_TOKEN });

    const [, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } })
      .mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});
