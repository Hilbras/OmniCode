import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { errorInfo } from '#/_base/errors/codes';
import { retryDelayMs, sleepForRetry } from '#/_base/utils/retry';
import { LifecycleScope } from '#/app/scopes';

import { VercelError, VercelErrors } from './errors';
import type { VercelClientOptions, VercelFetchImpl, VercelSleep } from './types';

const DEFAULT_BASE_URL = 'https://api.vercel.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const USER_AGENT = 'omnicode-vercel-connector';

export interface VercelApiRequest {
  readonly path: string;
  readonly method?: string;
  readonly token?: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export const IVercelApiClient: ServiceIdentifier<VercelApiClient> =
  createDecorator<VercelApiClient>('vercelApiClient');

interface VercelRequestFailure {
  readonly error: VercelError;
  readonly retryAfterMs?: number;
}

type AttemptResult =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly failure: VercelRequestFailure };

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  return sleepForRetry(delayMs, signal);
}

export class VercelApiClient {
  private readonly fetchImpl: VercelFetchImpl;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: VercelSleep;

  constructor(options: VercelClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.sleep = options.sleep ?? defaultSleep;
  }

  async request<T>(request: VercelApiRequest): Promise<T> {
    const url = this.buildUrl(request);
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.attempt(url, request);
      if (outcome.ok) {
        if (outcome.response.ok) return await this.readBody<T>(outcome.response, request.token);
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

  private async attempt(url: string, request: VercelApiRequest): Promise<AttemptResult> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal =
      request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);
    const headers: Record<string, string> = {
      accept: 'application/json',
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

  private buildUrl(request: VercelApiRequest): string {
    const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
    const query = buildQuery(request.query);
    return `${this.baseUrl}${path}${query}`;
  }

  private async readBody<T>(response: Response, token: string | undefined): Promise<T> {
    const text = await response.text();
    if (text.trim().length === 0) return undefined as T;
    try {
      return JSON.parse(redactTokenText(text, token)) as T;
    } catch (error) {
      throw new VercelError(
        VercelErrors.codes.API_ERROR,
        `Vercel returned a malformed response (HTTP ${response.status}).`,
        { cause: error, details: { status: response.status } },
      );
    }
  }
}

function redactTokenText(text: string, token: string | undefined): string {
  if (token === undefined || token.length === 0) return text;
  return text.replaceAll(token, '[REDACTED]');
}

function isRetryable(error: VercelError): boolean {
  return errorInfo(error.code).retryable;
}

function buildQuery(query: VercelApiRequest['query']): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}

function networkFailure(error: unknown, timeoutMs: number): VercelRequestFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: new VercelError(
      VercelErrors.codes.NETWORK_ERROR,
      `The Vercel request did not complete within ${String(timeoutMs)}ms: ${message}`,
      { cause: error, details: { timeoutMs } },
    ),
  };
}

function classifyFailure(response: Response, url: string): VercelRequestFailure {
  const status = response.status;
  if (status === 401) {
    return {
      error: new VercelError(
        VercelErrors.codes.TOKEN_INVALID,
        `Vercel rejected the access token (HTTP 401) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  if (status === 403 || status === 429) {
    const retryAfterMs = readRetryAfterMs(response);
    const remaining = readRateLimitRemaining(response);
    if (retryAfterMs !== undefined || remaining === '0' || status === 429) {
      return {
        error: new VercelError(
          VercelErrors.codes.RATE_LIMITED,
          `Vercel rate limit reached (HTTP ${String(status)}) for ${url}.`,
          { details: { status } },
        ),
        retryAfterMs: retryAfterMs ?? readRateLimitResetMs(response),
      };
    }
    return {
      error: new VercelError(
        VercelErrors.codes.FORBIDDEN,
        `Vercel denied the request (HTTP ${String(status)}) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  if (status === 404) {
    return {
      error: new VercelError(
        VercelErrors.codes.NOT_FOUND,
        `Vercel has no such resource (HTTP 404) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  if (status >= 500) {
    return {
      error: new VercelError(
        VercelErrors.codes.SERVER_ERROR,
        `Vercel server error (HTTP ${String(status)}) for ${url}.`,
        { details: { status } },
      ),
    };
  }
  return {
    error: new VercelError(
      VercelErrors.codes.API_ERROR,
      `Vercel request failed (HTTP ${String(status)}) for ${url}.`,
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

function readRateLimitRemaining(response: Response): string | undefined {
  return (
    response.headers.get('ratelimit-remaining') ??
    response.headers.get('x-ratelimit-remaining') ??
    undefined
  );
}

function readRateLimitResetMs(response: Response): number | undefined {
  const raw = response.headers.get('ratelimit-reset') ?? response.headers.get('x-ratelimit-reset');
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (value > 1_000_000_000) return Math.max(value * 1000 - Date.now(), 0);
  return Math.round(value * 1000);
}

registerScopedService(
  LifecycleScope.App,
  IVercelApiClient,
  VercelApiClient,
  ScopeActivation.OnDemand,
  'vercel',
);
