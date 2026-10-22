import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { errorInfo } from '#/_base/errors/codes';
import { retryDelayMs, sleepForRetry } from '#/_base/utils/retry';
import { LifecycleScope } from '#/app/scopes';

import { GitHubError, GitHubErrors } from './errors';
import type { GitHubClientOptions, GitHubFetchImpl, GitHubSleep } from './types';

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const USER_AGENT = 'omnicode-github-connector';
const GITHUB_API_VERSION = '2022-11-28';

export interface GitHubApiRequest {
  readonly path: string;
  readonly method?: string;
  readonly token?: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export const IGitHubApiClient: ServiceIdentifier<GitHubApiClient> =
  createDecorator<GitHubApiClient>('githubApiClient');

interface GitHubRequestFailure {
  readonly error: GitHubError;
  readonly retryAfterMs?: number;
}

type AttemptResult =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly failure: GitHubRequestFailure };

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  return sleepForRetry(delayMs, signal);
}

export class GitHubApiClient {
  private readonly fetchImpl: GitHubFetchImpl;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: GitHubSleep;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.sleep = options.sleep ?? defaultSleep;
  }

  async request<T>(request: GitHubApiRequest): Promise<T> {
    const url = this.buildUrl(request);
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.attempt(url, request);
      if (outcome.ok) {
        if (outcome.response.ok) return await this.readBody<T>(outcome.response);
        const failure = classifyFailure(outcome.response, url);
        if (!isRetryable(failure.error) || attempt >= this.maxAttempts - 1) {
          throw failure.error;
        }
        await this.sleep(retryDelayMs(attempt, failure.retryAfterMs), request.signal);
        continue;
      }
      if (!isRetryable(outcome.failure.error) || attempt >= this.maxAttempts - 1) {
        throw outcome.failure.error;
      }
      await this.sleep(retryDelayMs(attempt, outcome.failure.retryAfterMs), request.signal);
    }
  }

  private async attempt(url: string, request: GitHubApiRequest): Promise<AttemptResult> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal =
      request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': USER_AGENT,
      ...request.headers,
    };
    if (request.token !== undefined) headers['authorization'] = `Bearer ${request.token}`;
    let body: string | undefined;
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    try {
      const response = await this.fetchImpl(url, {
        method: request.method ?? 'GET',
        headers,
        body,
        signal,
      });
      return { ok: true, response };
    } catch (error) {
      if (request.signal?.aborted === true) throw error;
      return { ok: false, failure: networkFailure(error, this.timeoutMs) };
    }
  }

  private buildUrl(request: GitHubApiRequest): string {
    const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
    const query = buildQuery(request.query);
    return `${this.baseUrl}${path}${query}`;
  }

  private async readBody<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (text.trim().length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new GitHubError(
        GitHubErrors.codes.API_ERROR,
        `GitHub returned a malformed response (HTTP ${response.status}).`,
        { cause: error, details: { status: response.status } },
      );
    }
  }
}

function isRetryable(error: GitHubError): boolean {
  return errorInfo(error.code).retryable;
}

function buildQuery(query: GitHubApiRequest['query']): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}

function networkFailure(error: unknown, timeoutMs: number): GitHubRequestFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: new GitHubError(
      GitHubErrors.codes.NETWORK_ERROR,
      `The GitHub request did not complete within ${String(timeoutMs)}ms: ${message}`,
      { cause: error, details: { timeoutMs } },
    ),
  };
}

function classifyFailure(response: Response, url: string): GitHubRequestFailure {
  const status = response.status;
  if (status === 401) {
    return {
      error: new GitHubError(
        GitHubErrors.codes.TOKEN_REVOKED,
        `GitHub rejected the stored authorization (HTTP 401) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  if (status === 404) {
    return {
      error: new GitHubError(
        GitHubErrors.codes.NOT_FOUND,
        `GitHub has no such resource (HTTP 404) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  if (status === 403 || status === 429) {
    const retryAfterMs = readRetryAfterMs(response);
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (retryAfterMs !== undefined || remaining === '0' || status === 429) {
      return {
        error: new GitHubError(
          GitHubErrors.codes.RATE_LIMITED,
          `GitHub rate limit reached (HTTP ${String(status)}) for ${url}.`,
          { details: { status } },
        ),
        retryAfterMs: retryAfterMs ?? readRateLimitResetMs(response),
      };
    }
    return {
      error: new GitHubError(
        GitHubErrors.codes.API_ERROR,
        `GitHub denied the request (HTTP ${String(status)}) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  if (status >= 500) {
    return {
      error: new GitHubError(
        GitHubErrors.codes.SERVER_ERROR,
        `GitHub server error (HTTP ${String(status)}) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  return {
    error: new GitHubError(
      GitHubErrors.codes.API_ERROR,
      `GitHub request failed (HTTP ${String(status)}) for ${url}.`,
      { details: { status } },
    ),
  };
}

function readRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(timestamp - Date.now(), 0);
}

function readRateLimitResetMs(response: Response): number | undefined {
  const raw = response.headers.get('x-ratelimit-reset');
  if (raw === null) return undefined;
  const resetSeconds = Number(raw);
  if (!Number.isFinite(resetSeconds)) return undefined;
  return Math.max(resetSeconds * 1000 - Date.now(), 0);
}

registerScopedService(
  LifecycleScope.App,
  IGitHubApiClient,
  GitHubApiClient,
  ScopeActivation.OnDemand,
  'github',
);
