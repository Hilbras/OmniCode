import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';

import { GitHubError, GitHubErrors } from './errors';
import type {
  GitHubClientOptions,
  GitHubDeviceCodeResponse,
  GitHubFetchImpl,
  GitHubRepositoryAccess,
} from './types';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'omnicode-github-connector';

export interface GitHubIssuedToken {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly scopes: readonly string[];
  readonly expiresInSeconds?: number;
  readonly repositoryAccess: GitHubRepositoryAccess;
  readonly repositories: readonly string[];
}

export type GitHubDeviceTokenResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'slow_down' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'issued'; readonly token: GitHubIssuedToken };

export interface GitHubDeviceFlowRequest {
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly signal?: AbortSignal;
}

export interface GitHubDeviceTokenRequest {
  readonly clientId: string;
  readonly deviceCode: string;
  readonly signal?: AbortSignal;
}

export const IGitHubDeviceFlowClient: ServiceIdentifier<GitHubDeviceFlowClient> =
  createDecorator<GitHubDeviceFlowClient>('githubDeviceFlowClient');

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export class GitHubDeviceFlowClient {
  private readonly fetchImpl: GitHubFetchImpl;
  private readonly timeoutMs: number;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async requestDeviceCode(request: GitHubDeviceFlowRequest): Promise<GitHubDeviceCodeResponse> {
    const body = new URLSearchParams();
    body.set('client_id', request.clientId);
    if (request.scopes.length > 0) body.set('scope', request.scopes.join(' '));
    const payload = await this.post(DEVICE_CODE_URL, body, request.signal);
    const deviceCode = readString(payload, 'device_code');
    const userCode = readString(payload, 'user_code');
    const verificationUri = readString(payload, 'verification_uri');
    if (deviceCode === undefined || userCode === undefined || verificationUri === undefined) {
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_FAILED,
        'GitHub did not return a usable device code.',
        { details: { fields: Object.keys(payload) } },
      );
    }
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: readString(payload, 'verification_uri_complete'),
      expiresInSeconds: readNumber(payload, 'expires_in') ?? 900,
      intervalSeconds: readNumber(payload, 'interval') ?? 5,
      scopes: request.scopes,
    };
  }

  async pollAccessToken(request: GitHubDeviceTokenRequest): Promise<GitHubDeviceTokenResult> {
    const body = new URLSearchParams();
    body.set('client_id', request.clientId);
    body.set('device_code', request.deviceCode);
    body.set('grant_type', DEVICE_CODE_GRANT_TYPE);
    const payload = await this.post(ACCESS_TOKEN_URL, body, request.signal);
    const error = readString(payload, 'error');
    if (error !== undefined) {
      return interpretDeviceError(error, readString(payload, 'error_description'));
    }
    const accessToken = readString(payload, 'access_token');
    if (accessToken === undefined) {
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_FAILED,
        'GitHub did not return an access token for the device code.',
        { details: { fields: Object.keys(payload) } },
      );
    }
    return {
      kind: 'issued',
      token: {
        accessToken,
        refreshToken: readString(payload, 'refresh_token'),
        tokenType: readString(payload, 'token_type') ?? 'bearer',
        scopes: readScopeList(payload),
        expiresInSeconds: readNumber(payload, 'expires_in'),
        repositoryAccess: readRepositoryAccess(payload),
        repositories: readRepositoryNames(payload),
      },
    };
  }

  private async post(
    url: string,
    body: URLSearchParams,
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const composed =
      signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': USER_AGENT,
        },
        body: body.toString(),
        signal: composed,
      });
    } catch (error) {
      throw new GitHubError(
        GitHubErrors.codes.NETWORK_ERROR,
        `The GitHub device flow request did not complete: ${describeError(error)}`,
        { cause: error },
      );
    }
    const text = await response.text();
    const payload = parseJsonObject(text);
    if (payload === undefined) {
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_FAILED,
        `GitHub returned a malformed device flow response (HTTP ${String(response.status)}).`,
        { details: { status: response.status } },
      );
    }
    if (!response.ok) {
      const error = readString(payload, 'error');
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_FAILED,
        `GitHub rejected the device flow request (HTTP ${String(response.status)})${
          error === undefined ? '' : `: ${error}`
        }.`,
        { details: { status: response.status, error } },
      );
    }
    return payload;
  }
}

function interpretDeviceError(
  error: string,
  description: string | undefined,
): GitHubDeviceTokenResult {
  const suffix = description === undefined ? '' : `: ${description}`;
  switch (error) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slow_down' };
    case 'access_denied':
      return { kind: 'denied' };
    case 'expired_token':
      return { kind: 'expired' };
    default:
      throw new GitHubError(
        GitHubErrors.codes.DEVICE_FLOW_FAILED,
        `GitHub device flow failed${suffix}.`,
        { details: { error } },
      );
  }
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  if (text.trim().length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  return value.length > 0 ? value : undefined;
}

function readNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function readScopeList(payload: Record<string, unknown>): string[] {
  const raw = payload['scope'];
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function readRepositoryAccess(payload: Record<string, unknown>): GitHubRepositoryAccess {
  const value = payload['repository_access'];
  if (value === 'all') return 'all';
  if (value === 'selected') return 'selected';
  if (value === 2) return 'all';
  if (value === 1) return 'selected';
  return 'none';
}

function readRepositoryNames(payload: Record<string, unknown>): string[] {
  const value = payload['repositories'];
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const fullName = (entry as Record<string, unknown>)['full_name'];
    if (typeof fullName === 'string' && fullName.length > 0) names.push(fullName);
  }
  return names;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

registerScopedService(
  LifecycleScope.App,
  IGitHubDeviceFlowClient,
  GitHubDeviceFlowClient,
  ScopeActivation.OnDemand,
  'github',
);
