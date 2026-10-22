import { randomUUID } from 'node:crypto';

import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IConfigService } from '#/app/config/config';
import { LifecycleScope } from '#/app/scopes';

import { DEFAULT_GITHUB_SCOPES, GITHUB_SECTION, type GitHubSection } from './configSection';
import { IGitHubCredentialStore } from './credentialStore';
import {
  type GitHubDeviceFlowClient,
  type GitHubIssuedToken,
  IGitHubDeviceFlowClient,
} from './deviceFlow';
import { GitHubError, GitHubErrors } from './errors';
import {
  type GitHubDeviceFlowPollOptions,
  type GitHubIssueListOptions,
  type GitHubListOptions,
  type GitHubPullRequestListOptions,
  IGitHubService,
} from './github';
import { GitHubApiClient, IGitHubApiClient, type GitHubApiRequest } from './httpClient';
import type {
  GitHubConnectResult,
  GitHubConnectionStatus,
  GitHubCredential,
  GitHubDeviceFlowStart,
  GitHubDisconnectResult,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestSummary,
  GitHubRepository,
  GitHubUser,
  GitHubWorkflowRun,
} from './types';

const REPOSITORY_SCOPES: readonly string[] = ['repo', 'public_repo'];
const WORKFLOW_SCOPES: readonly string[] = ['repo', 'workflow'];
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface GitHubRepositoryTarget {
  readonly owner: string;
  readonly repo: string;
  readonly fullName: string;
}

interface CredentialRequirements {
  readonly scopes?: readonly string[];
  readonly repository?: string;
}

interface PendingDeviceFlow {
  readonly deviceCode: string;
  readonly expiresAt: number;
}

export class GitHubService implements IGitHubService {
  declare readonly _serviceBrand: undefined;

  private readonly pendingFlows = new Map<string, PendingDeviceFlow>();

  constructor(
    @IGitHubApiClient private readonly api: GitHubApiClient,
    @IGitHubDeviceFlowClient private readonly deviceFlow: GitHubDeviceFlowClient,
    @IConfigService private readonly config: IConfigService,
    @IGitHubCredentialStore private readonly credentials: IGitHubCredentialStore,
  ) {}

  async status(): Promise<GitHubConnectionStatus> {
    const configured = this.clientId() !== undefined;
    const credential = await this.credentials.read();
    if (credential === undefined) {
      return {
        configured,
        connected: false,
        scopes: [],
        expired: false,
        repositoryAccess: 'none',
        repositories: [],
      };
    }
    return {
      configured,
      connected: true,
      accountLogin: credential.login,
      scopes: credential.scopes,
      expiresAt: credential.expiresAt,
      expired: isExpired(credential),
      repositoryAccess: credential.repositoryAccess,
      repositories: credential.repositories,
    };
  }

  async startDeviceFlow(): Promise<GitHubDeviceFlowStart> {
    const clientId = this.requireClientId();
    const start = await this.deviceFlow.requestDeviceCode({ clientId, scopes: this.scopes() });
    const flowId = randomUUID();
    this.pendingFlows.set(flowId, {
      deviceCode: start.deviceCode,
      expiresAt: Date.now() + start.expiresInSeconds * 1000,
    });
    return {
      flowId,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      verificationUriComplete: start.verificationUriComplete,
      expiresInSeconds: start.expiresInSeconds,
      intervalSeconds: start.intervalSeconds,
      scopes: start.scopes,
    };
  }

  async pollDeviceFlow(
    flowId: string,
    options: GitHubDeviceFlowPollOptions = {},
  ): Promise<GitHubConnectResult> {
    const clientId = this.requireClientId();
    const flow = this.pendingFlows.get(flowId);
    if (flow === undefined) {
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_NOT_FOUND,
        'The GitHub authorization request is unknown or already finished. Start the connection again.',
      );
    }
    if (flow.expiresAt <= Date.now()) {
      this.pendingFlows.delete(flowId);
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_EXPIRED,
        'The GitHub device code expired before it was approved.',
      );
    }
    const result = await this.deviceFlow.pollAccessToken({
      clientId,
      deviceCode: flow.deviceCode,
      signal: options.signal,
    });
    switch (result.kind) {
      case 'pending':
        return { kind: 'pending' };
      case 'slow_down':
        return { kind: 'slow_down' };
      case 'denied':
        this.pendingFlows.delete(flowId);
        throw new GitHubError(
          GitHubErrors.codes.DEVICE_FLOW_DENIED,
          'The GitHub authorization was denied.',
        );
      case 'expired':
        this.pendingFlows.delete(flowId);
        throw new GitHubError(
          GitHubErrors.codes.DEVICE_FLOW_EXPIRED,
          'The GitHub device code expired before it was approved.',
        );
      case 'issued': {
        this.pendingFlows.delete(flowId);
        const credential = await this.buildCredential(result.token);
        await this.credentials.write(credential);
        return { kind: 'connected', status: await this.status() };
      }
    }
  }

  async disconnect(): Promise<GitHubDisconnectResult> {
    const credential = await this.credentials.read();
    if (credential === undefined) {
      return {
        disconnected: false,
        providerRevoked: false,
        message: 'GitHub was not connected, so no local credential was removed.',
      };
    }
    await this.credentials.clear();
    return {
      disconnected: true,
      providerRevoked: false,
      message:
        'The local GitHub credential was removed. The OAuth grant stays active at GitHub until it is revoked in the GitHub account settings.',
    };
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const credential = await this.requireCredential({});
    return mapUser(await this.call(credential, { path: '/user' }));
  }

  async listRepositories(options: GitHubListOptions = {}): Promise<GitHubRepository[]> {
    const credential = await this.requireCredential({ scopes: REPOSITORY_SCOPES });
    const payload = await this.call(credential, {
      path: '/user/repos',
      query: { per_page: clampLimit(options.limit), sort: 'updated' },
    });
    return toArray(payload).map(mapRepository);
  }

  async listIssues(
    repository: string,
    options: GitHubIssueListOptions = {},
  ): Promise<GitHubIssue[]> {
    const target = parseRepository(repository);
    const credential = await this.requireCredential({
      scopes: REPOSITORY_SCOPES,
      repository: target.fullName,
    });
    const payload = await this.call(credential, {
      path: `/repos/${target.owner}/${target.repo}/issues`,
      query: { per_page: clampLimit(options.limit), state: options.state ?? 'open' },
    });
    return toArray(payload).map(mapIssue);
  }

  async listPullRequests(
    repository: string,
    options: GitHubPullRequestListOptions = {},
  ): Promise<GitHubPullRequestSummary[]> {
    const target = parseRepository(repository);
    const credential = await this.requireCredential({
      scopes: REPOSITORY_SCOPES,
      repository: target.fullName,
    });
    const payload = await this.call(credential, {
      path: `/repos/${target.owner}/${target.repo}/pulls`,
      query: { per_page: clampLimit(options.limit), state: options.state ?? 'open' },
    });
    return toArray(payload).map(mapPullRequestSummary);
  }

  async getPullRequest(repository: string, number: number): Promise<GitHubPullRequest> {
    const target = parseRepository(repository);
    const credential = await this.requireCredential({
      scopes: REPOSITORY_SCOPES,
      repository: target.fullName,
    });
    const payload = await this.call(credential, {
      path: `/repos/${target.owner}/${target.repo}/pulls/${String(number)}`,
    });
    return mapPullRequest(payload);
  }

  async listWorkflowRuns(
    repository: string,
    options: GitHubListOptions = {},
  ): Promise<GitHubWorkflowRun[]> {
    const target = parseRepository(repository);
    const credential = await this.requireCredential({
      scopes: WORKFLOW_SCOPES,
      repository: target.fullName,
    });
    const payload = await this.call(credential, {
      path: `/repos/${target.owner}/${target.repo}/actions/runs`,
      query: { per_page: clampLimit(options.limit) },
    });
    const record = asRecord(payload);
    const runs = record['workflow_runs'];
    return toArray(runs).map(mapWorkflowRun);
  }

  private async buildCredential(token: GitHubIssuedToken): Promise<GitHubCredential> {
    const user = await this.readAuthorizedUser(token.accessToken);
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      expiresAt:
        token.expiresInSeconds === undefined
          ? undefined
          : Date.now() + token.expiresInSeconds * 1000,
      scopes: token.scopes,
      login: user.login,
      repositoryAccess: token.repositoryAccess,
      repositories: token.repositories,
    };
  }

  private async readAuthorizedUser(accessToken: string): Promise<GitHubUser> {
    try {
      return mapUser(await this.api.request({ path: '/user', token: accessToken }));
    } catch (error) {
      if (error instanceof GitHubError && error.code === GitHubErrors.codes.TOKEN_REVOKED) {
        await this.credentials.clear();
      }
      throw error;
    }
  }

  private async requireCredential(requirements: CredentialRequirements): Promise<GitHubCredential> {
    const credential = await this.credentials.read();
    if (credential === undefined) {
      throw new GitHubError(
        GitHubErrors.codes.NOT_CONNECTED,
        'GitHub is not connected. Authorize a GitHub account before using GitHub tools.',
      );
    }
    if (isExpired(credential)) {
      throw new GitHubError(
        GitHubErrors.codes.TOKEN_EXPIRED,
        'The GitHub authorization has expired. Reconnect GitHub to continue.',
      );
    }
    if (
      requirements.scopes !== undefined &&
      !hasRequiredScope(credential.scopes, requirements.scopes)
    ) {
      throw new GitHubError(
        GitHubErrors.codes.SCOPE_DENIED,
        `The GitHub authorization does not grant the required scope (${requirements.scopes.join(' or ')}). Granted scopes: ${describeScopes(credential.scopes)}.`,
        { details: { required: requirements.scopes, granted: credential.scopes } },
      );
    }
    if (requirements.repository !== undefined) {
      assertRepositoryAllowed(credential, requirements.repository);
    }
    return credential;
  }

  private async call<T>(credential: GitHubCredential, request: GitHubApiRequest): Promise<T> {
    try {
      return await this.api.request<T>({ ...request, token: credential.accessToken });
    } catch (error) {
      if (error instanceof GitHubError && error.code === GitHubErrors.codes.TOKEN_REVOKED) {
        await this.credentials.clear();
      }
      throw error;
    }
  }

  private clientId(): string | undefined {
    const section = this.config.get<GitHubSection | undefined>(GITHUB_SECTION);
    const clientId = section?.clientId?.trim();
    return clientId === undefined || clientId.length === 0 ? undefined : clientId;
  }

  private scopes(): string[] {
    const section = this.config.get<GitHubSection | undefined>(GITHUB_SECTION);
    const configured = section?.scopes;
    if (configured !== undefined && configured.length > 0) return [...configured];
    return [...DEFAULT_GITHUB_SCOPES];
  }

  private requireClientId(): string {
    const clientId = this.clientId();
    if (clientId === undefined) {
      throw new GitHubError(
        GitHubErrors.codes.NOT_CONFIGURED,
        'The GitHub connector is not configured: set github.clientId (or OMNICODE_GITHUB_CLIENT_ID) to the OAuth app client id.',
      );
    }
    return clientId;
  }
}

function isExpired(credential: GitHubCredential): boolean {
  return credential.expiresAt !== undefined && credential.expiresAt <= Date.now();
}

function hasRequiredScope(granted: readonly string[], required: readonly string[]): boolean {
  return required.some((scope) => granted.includes(scope));
}

function describeScopes(scopes: readonly string[]): string {
  return scopes.length === 0 ? 'none' : scopes.join(', ');
}

function assertRepositoryAllowed(credential: GitHubCredential, repository: string): void {
  if (credential.repositoryAccess !== 'selected') return;
  const allowed = credential.repositories.map((entry) => entry.toLowerCase());
  if (allowed.includes(repository.toLowerCase())) return;
  throw new GitHubError(
    GitHubErrors.codes.SCOPE_DENIED,
    `The GitHub authorization only covers ${String(credential.repositories.length)} repository or repositories and does not include "${repository}".`,
    { details: { repository, repositories: credential.repositories } },
  );
}

function parseRepository(repository: string): GitHubRepositoryTarget {
  const trimmed = repository.trim();
  const parts = trimmed.split('/');
  const owner = parts[0];
  const repo = parts[1];
  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    owner.length === 0 ||
    repo.length === 0
  ) {
    throw new GitHubError(
      GitHubErrors.codes.INVALID_REPOSITORY,
      `"${trimmed}" is not a valid GitHub repository: use the "owner/name" form.`,
    );
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
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

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readLabelNames(record: Record<string, unknown>): string[] {
  const labels = record['labels'];
  if (!Array.isArray(labels)) return [];
  const names: string[] = [];
  for (const label of labels) {
    if (typeof label === 'string') {
      names.push(label);
      continue;
    }
    const name = readString(asRecord(label), 'name');
    if (name !== undefined) names.push(name);
  }
  return names;
}

function mapUser(payload: unknown): GitHubUser {
  const record = asRecord(payload);
  const login = readString(record, 'login');
  if (login === undefined) {
    throw new GitHubError(
      GitHubErrors.codes.API_ERROR,
      'GitHub did not return the authenticated user.',
    );
  }
  return {
    login,
    id: readNumber(record, 'id') ?? 0,
    name: readString(record, 'name'),
    htmlUrl: readString(record, 'html_url') ?? `https://github.com/${login}`,
    type: readString(record, 'type'),
  };
}

function mapRepository(payload: unknown): GitHubRepository {
  const record = asRecord(payload);
  const name = readString(record, 'name') ?? '';
  const owner = readString(asRecord(record['owner']), 'login') ?? '';
  const fullName = readString(record, 'full_name') ?? `${owner}/${name}`;
  return {
    id: readNumber(record, 'id') ?? 0,
    name,
    fullName,
    private: readBoolean(record, 'private'),
    htmlUrl: readString(record, 'html_url') ?? `https://github.com/${fullName}`,
    defaultBranch: readString(record, 'default_branch'),
    description: readString(record, 'description'),
  };
}

function mapIssue(payload: unknown): GitHubIssue {
  const record = asRecord(payload);
  const number = readNumber(record, 'number') ?? 0;
  return {
    number,
    title: readString(record, 'title') ?? '',
    state: readString(record, 'state') ?? 'unknown',
    htmlUrl: readString(record, 'html_url') ?? '',
    author: readString(asRecord(record['user']), 'login') ?? 'unknown',
    createdAt: readString(record, 'created_at') ?? '',
    updatedAt: readString(record, 'updated_at') ?? '',
    labels: readLabelNames(record),
    isPullRequest: record['pull_request'] !== undefined,
  };
}

function mapPullRequestSummary(payload: unknown): GitHubPullRequestSummary {
  const record = asRecord(payload);
  return {
    number: readNumber(record, 'number') ?? 0,
    title: readString(record, 'title') ?? '',
    state: readString(record, 'state') ?? 'unknown',
    draft: readBoolean(record, 'draft'),
    htmlUrl: readString(record, 'html_url') ?? '',
    author: readString(asRecord(record['user']), 'login') ?? 'unknown',
    createdAt: readString(record, 'created_at') ?? '',
    updatedAt: readString(record, 'updated_at') ?? '',
    headRef: readString(asRecord(record['head']), 'ref') ?? '',
    baseRef: readString(asRecord(record['base']), 'ref') ?? '',
  };
}

function mapPullRequest(payload: unknown): GitHubPullRequest {
  const record = asRecord(payload);
  return {
    ...mapPullRequestSummary(record),
    body: readString(record, 'body'),
    merged: readBoolean(record, 'merged'),
    mergeable: typeof record['mergeable'] === 'boolean' ? record['mergeable'] : undefined,
    additions: readNumber(record, 'additions') ?? 0,
    deletions: readNumber(record, 'deletions') ?? 0,
    changedFiles: readNumber(record, 'changed_files') ?? 0,
    commits: readNumber(record, 'commits') ?? 0,
  };
}

function mapWorkflowRun(payload: unknown): GitHubWorkflowRun {
  const record = asRecord(payload);
  return {
    id: readNumber(record, 'id') ?? 0,
    name: readString(record, 'name') ?? readString(record, 'display_title') ?? '',
    status: readString(record, 'status') ?? 'unknown',
    conclusion: readString(record, 'conclusion'),
    event: readString(record, 'event') ?? 'unknown',
    htmlUrl: readString(record, 'html_url') ?? '',
    headBranch: readString(record, 'head_branch') ?? '',
    headSha: readString(record, 'head_sha') ?? '',
    createdAt: readString(record, 'created_at') ?? '',
    updatedAt: readString(record, 'updated_at') ?? '',
  };
}

registerScopedService(
  LifecycleScope.App,
  IGitHubService,
  GitHubService,
  ScopeActivation.OnDemand,
  'github',
);
