import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IConfigService } from '#/app/config/config';
import { LifecycleScope } from '#/app/scopes';

import { VERCEL_SECTION, type VercelSection } from './configSection';
import { IVercelCredentialStore } from './credentialStore';
import { VercelError, VercelErrors } from './errors';
import { IVercelApiClient, VercelApiClient, type VercelApiRequest } from './httpClient';
import type {
  VercelAccount,
  VercelConnectResult,
  VercelConnectionStatus,
  VercelCredential,
  VercelDeployment,
  VercelDeploymentEvent,
  VercelDisconnectResult,
  VercelProject,
  VercelScope,
  VercelTeam,
  VercelUser,
} from './types';
import {
  IVercelService,
  type VercelDeploymentListOptions,
  type VercelListOptions,
  type VercelProjectListOptions,
} from './vercel';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_TEAM_LIMIT = 100;

interface VercelResolvedScope {
  readonly scope: VercelScope;
  readonly accounts: readonly VercelAccount[];
}

export class VercelService implements IVercelService {
  declare readonly _serviceBrand: undefined;

  private readonly configuredCredentials = new Map<string, VercelCredential>();

  constructor(
    @IVercelApiClient private readonly api: VercelApiClient,
    @IConfigService private readonly config: IConfigService,
    @IVercelCredentialStore private readonly credentials: IVercelCredentialStore,
  ) {}

  async status(): Promise<VercelConnectionStatus> {
    const stored = await this.credentials.read();
    const configured = stored !== undefined || this.configToken() !== undefined;
    if (stored === undefined) {
      return { configured, connected: false, scopes: [], expired: false };
    }
    return {
      configured,
      connected: true,
      accountId: stored.scope.id,
      accountType: stored.scope.type,
      accountSlug: stored.scope.slug,
      accountName: stored.scope.name,
      username: stored.username,
      scopes: stored.scopes,
      expiresAt: stored.expiresAt,
      expired: isExpired(stored),
    };
  }

  async connect(token?: string): Promise<VercelConnectResult> {
    const trimmed = (token ?? this.configToken() ?? '').trim();
    if (trimmed.length === 0) {
      throw new VercelError(
        VercelErrors.codes.NOT_CONFIGURED,
        'A Vercel access token is required to connect the Vercel connector. Set vercel.token or OMNICODE_VERCEL_TOKEN.',
      );
    }
    const credential = await this.buildCredential(trimmed);
    await this.credentials.write(credential);
    this.configuredCredentials.delete(trimmed);
    return {
      connected: true,
      status: await this.status(),
      message: `The Vercel connector is connected as ${describeScope(credential.scope)}.`,
    };
  }

  async disconnect(): Promise<VercelDisconnectResult> {
    const credential = await this.credentials.read();
    if (credential === undefined) {
      return {
        disconnected: false,
        message:
          'No Vercel credential was stored, so nothing was removed. A token configured through vercel.token stays in effect.',
      };
    }
    await this.credentials.clear();
    this.configuredCredentials.delete(credential.accessToken);
    return {
      disconnected: true,
      message:
        'The stored Vercel credential was removed. The token stays valid at Vercel until it is revoked in the Vercel account settings.',
    };
  }

  async getAuthenticatedUser(): Promise<VercelUser> {
    const credential = await this.resolveCredential();
    return mapUser(await this.call(credential, { path: '/v2/user' }));
  }

  async listProjects(options: VercelProjectListOptions = {}): Promise<VercelProject[]> {
    const credential = await this.resolveCredential();
    const payload = await this.call(credential, {
      path: '/v10/projects',
      query: {
        limit: clampLimit(options.limit),
        search: options.search,
        teamId: credential.scope.type === 'team' ? credential.scope.id : undefined,
      },
    });
    return readProjectList(payload).map((entry) => {
      const project = this.toProject(credential, entry);
      assertAccountAllowed(credential, project.accountId, `the project "${project.name}"`);
      return project;
    });
  }

  async listDeployments(
    project: string,
    options: VercelDeploymentListOptions = {},
  ): Promise<VercelDeployment[]> {
    const credential = await this.resolveCredential();
    const resolved = await this.resolveProject(credential, project);
    const payload = await this.call(credential, {
      path: '/v7/deployments',
      query: {
        projectId: resolved.id,
        limit: clampLimit(options.limit),
        target: options.target,
      },
    });
    return readDeploymentList(payload).map(mapDeployment);
  }

  async getDeployment(deploymentId: string): Promise<VercelDeployment> {
    const credential = await this.resolveCredential();
    const trimmed = deploymentId.trim();
    if (trimmed.length === 0) {
      throw new VercelError(
        VercelErrors.codes.INVALID_DEPLOYMENT,
        'A Vercel deployment id or deployment url is required.',
      );
    }
    const payload = await this.call(credential, {
      path: `/v13/deployments/${encodeURIComponent(trimmed)}`,
    });
    const deployment = mapDeployment(payload);
    await this.assertDeploymentAllowed(credential, deployment);
    return deployment;
  }

  async getDeploymentEvents(
    deploymentId: string,
    options: VercelListOptions = {},
  ): Promise<VercelDeploymentEvent[]> {
    const credential = await this.resolveCredential();
    const deployment = await this.getDeployment(deploymentId);
    const id = deployment.id.length > 0 ? deployment.id : deploymentId.trim();
    const payload = await this.call(credential, {
      path: `/v3/deployments/${encodeURIComponent(id)}/events`,
      query: { limit: clampLimit(options.limit), builds: 1 },
    });
    return readEventList(payload).map(mapEvent);
  }

  private async buildCredential(token: string): Promise<VercelCredential> {
    const user = await this.readUser(token);
    const teams = await this.readTeams(token);
    const resolved = resolveScope(user, teams, this.configuredTeam());
    return {
      accessToken: token,
      userId: user.id,
      username: user.username,
      email: user.email,
      scope: resolved.scope,
      accounts: resolved.accounts,
      scopes: scopeLabels(resolved.accounts),
    };
  }

  private async readUser(token: string): Promise<VercelUser> {
    return mapUser(await this.api.request({ path: '/v2/user', token }));
  }

  private async readTeams(token: string): Promise<VercelTeam[]> {
    const payload = await this.api.request({
      path: '/v2/teams',
      token,
      query: { limit: MAX_TEAM_LIMIT },
    });
    return readTeamList(payload);
  }

  private async resolveCredential(): Promise<VercelCredential> {
    const stored = await this.credentials.read();
    if (stored !== undefined) {
      if (isExpired(stored)) {
        throw new VercelError(
          VercelErrors.codes.TOKEN_EXPIRED,
          'The stored Vercel access token has expired. Connect the Vercel connector again.',
        );
      }
      return stored;
    }
    const token = this.configToken();
    if (token === undefined) {
      throw new VercelError(
        VercelErrors.codes.NOT_CONFIGURED,
        'The Vercel connector is not configured: set vercel.token (or OMNICODE_VERCEL_TOKEN), or connect a Vercel access token.',
      );
    }
    const cached = this.configuredCredentials.get(token);
    if (cached !== undefined) return cached;
    const credential = await this.buildCredential(token);
    this.configuredCredentials.set(token, credential);
    return credential;
  }

  private async call<T>(credential: VercelCredential, request: VercelApiRequest): Promise<T> {
    try {
      return await this.api.request<T>({ ...request, token: credential.accessToken });
    } catch (error) {
      if (error instanceof VercelError && error.code === VercelErrors.codes.TOKEN_INVALID) {
        await this.credentials.clear();
        this.configuredCredentials.delete(credential.accessToken);
      }
      throw redactToken(error, credential.accessToken);
    }
  }

  private async resolveProject(
    credential: VercelCredential,
    projectRef: string,
  ): Promise<VercelProject> {
    const trimmed = projectRef.trim();
    if (trimmed.length === 0) {
      throw new VercelError(
        VercelErrors.codes.INVALID_PROJECT,
        'A Vercel project name or project id is required.',
      );
    }
    const payload = await this.call(credential, {
      path: `/v9/projects/${encodeURIComponent(trimmed)}`,
    });
    const project = this.toProject(credential, payload);
    assertAccountAllowed(credential, project.accountId, `the project "${project.name}"`);
    return project;
  }

  private async assertDeploymentAllowed(
    credential: VercelCredential,
    deployment: VercelDeployment,
  ): Promise<void> {
    if (deployment.accountId.length > 0) {
      assertAccountAllowed(credential, deployment.accountId, `the deployment "${deployment.id}"`);
      return;
    }
    await this.resolveProject(credential, deployment.projectId);
  }

  private toProject(credential: VercelCredential, payload: unknown): VercelProject {
    const accountId = readString(asRecord(payload), 'accountId');
    const slug =
      accountId === undefined
        ? undefined
        : credential.accounts.find((account) => account.id === accountId)?.slug;
    return mapProject(payload, slug);
  }

  private configToken(): string | undefined {
    const section = this.config.get<VercelSection | undefined>(VERCEL_SECTION);
    const token = section?.token?.trim();
    return token === undefined || token.length === 0 ? undefined : token;
  }

  private configuredTeam(): string | undefined {
    const section = this.config.get<VercelSection | undefined>(VERCEL_SECTION);
    const teamId = section?.teamId?.trim();
    if (teamId !== undefined && teamId.length > 0) return teamId;
    const teamSlug = section?.teamSlug?.trim();
    return teamSlug === undefined || teamSlug.length === 0 ? undefined : teamSlug;
  }
}

function isExpired(credential: VercelCredential): boolean {
  return credential.expiresAt !== undefined && credential.expiresAt <= Date.now();
}

function scopeLabels(accounts: readonly VercelAccount[]): string[] {
  const labels: string[] = [];
  for (const account of accounts) {
    if (!labels.includes(account.type)) labels.push(account.type);
  }
  return labels;
}

function describeScope(scope: VercelScope): string {
  return scope.type === 'team'
    ? `the team "${scope.slug ?? scope.id}"`
    : `the account "${scope.slug ?? scope.id}"`;
}

function resolveScope(
  user: VercelUser,
  teams: readonly VercelTeam[],
  configuredTeam: string | undefined,
): VercelResolvedScope {
  if (configuredTeam !== undefined) {
    const team = findTeam(teams, configuredTeam);
    if (team === undefined) {
      throw new VercelError(
        VercelErrors.codes.SCOPE_DENIED,
        `The Vercel token cannot reach the team "${configuredTeam}".`,
        { details: { team: configuredTeam } },
      );
    }
    return {
      scope: { type: 'team', id: team.id, slug: team.slug, name: team.name },
      accounts: [{ id: team.id, type: 'team', slug: team.slug, name: team.name }],
    };
  }
  if (teams.length === 1) {
    const team = teams[0]!;
    return {
      scope: { type: 'team', id: team.id, slug: team.slug, name: team.name },
      accounts: [
        { id: user.id, type: 'user', slug: user.username, name: user.name },
        { id: team.id, type: 'team', slug: team.slug, name: team.name },
      ],
    };
  }
  const accounts: VercelAccount[] = [
    { id: user.id, type: 'user', slug: user.username, name: user.name },
  ];
  for (const team of teams) {
    accounts.push({ id: team.id, type: 'team', slug: team.slug, name: team.name });
  }
  return {
    scope: { type: 'user', id: user.id, slug: user.username, name: user.name },
    accounts,
  };
}

function findTeam(teams: readonly VercelTeam[], reference: string): VercelTeam | undefined {
  return teams.find((team) => team.id === reference || team.slug === reference);
}

function assertAccountAllowed(
  credential: VercelCredential,
  accountId: string,
  subject: string,
): void {
  if (credential.accounts.some((account) => account.id === accountId)) return;
  throw new VercelError(
    VercelErrors.codes.SCOPE_DENIED,
    `The Vercel token is not authorized for the account that owns ${subject}.`,
    { details: { accountId, scope: credential.scope } },
  );
}

function redactToken(error: unknown, token: string): unknown {
  if (!(error instanceof VercelError)) return error;
  if (!error.message.includes(token)) return error;
  return new VercelError(error.code, error.message.replaceAll(token, '[REDACTED]'), {
    cause: error.cause,
    details: error.details,
  });
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function readProjectList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  return toArray(asRecord(payload)['projects']);
}

function readDeploymentList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  return toArray(asRecord(payload)['deployments']);
}

function readEventList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  return toArray(asRecord(payload)['events']);
}

function readTeamList(payload: unknown): VercelTeam[] {
  const teams: VercelTeam[] = [];
  for (const entry of toArray(asRecord(payload)['teams'])) {
    const record = asRecord(entry);
    const id = readString(record, 'id');
    const slug = readString(record, 'slug');
    if (id === undefined || slug === undefined) continue;
    teams.push({ id, slug, name: readString(record, 'name') });
  }
  return teams;
}

function mapUser(payload: unknown): VercelUser {
  const record = asRecord(asRecord(payload)['user']);
  const id = readString(record, 'id');
  const username = readString(record, 'username');
  if (id === undefined || username === undefined) {
    throw new VercelError(
      VercelErrors.codes.API_ERROR,
      'Vercel did not return the authenticated user.',
    );
  }
  return {
    id,
    username,
    email: readString(record, 'email'),
    name: readString(record, 'name'),
    defaultTeamId: readString(record, 'defaultTeamId'),
  };
}

function mapProject(payload: unknown, accountSlug: string | undefined): VercelProject {
  const record = asRecord(payload);
  const name = readString(record, 'name') ?? '';
  return {
    id: readString(record, 'id') ?? '',
    name,
    accountId: readString(record, 'accountId') ?? '',
    framework: readString(record, 'framework'),
    nodeVersion: readString(record, 'nodeVersion'),
    createdAt: readNumber(record, 'createdAt'),
    updatedAt: readNumber(record, 'updatedAt'),
    url:
      accountSlug === undefined
        ? `https://vercel.com/${name}`
        : `https://vercel.com/${accountSlug}/${name}`,
  };
}

function mapDeployment(payload: unknown): VercelDeployment {
  const record = asRecord(payload);
  const team = asRecord(record['team']);
  return {
    id: readString(record, 'id') ?? readString(record, 'uid') ?? '',
    name: readString(record, 'name') ?? '',
    projectId: readString(record, 'projectId') ?? '',
    accountId: readString(team, 'id') ?? readString(record, 'ownerId') ?? '',
    target: readString(record, 'target') ?? 'unknown',
    state: readString(record, 'state') ?? readString(record, 'readyState') ?? 'unknown',
    url: readString(record, 'url') ?? '',
    alias: toArray(record['alias']).filter((entry): entry is string => typeof entry === 'string'),
    createdAt: readNumber(record, 'createdAt') ?? readNumber(record, 'created'),
    errorCode: readString(record, 'errorCode'),
    errorMessage: readString(record, 'errorMessage'),
    source: readString(record, 'source'),
  };
}

function mapEvent(payload: unknown): VercelDeploymentEvent {
  const record = asRecord(payload);
  const inner = asRecord(record['payload']);
  return {
    type: readString(record, 'type') ?? 'unknown',
    text: readString(record, 'text') ?? readString(inner, 'text') ?? '',
    level: readString(record, 'level') ?? readString(inner, 'level'),
    createdAt: readNumber(record, 'created') ?? readNumber(inner, 'created'),
  };
}

registerScopedService(
  LifecycleScope.App,
  IVercelService,
  VercelService,
  ScopeActivation.OnDemand,
  'vercel',
);
