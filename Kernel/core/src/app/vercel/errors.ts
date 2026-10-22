import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';

export const VercelErrors = {
  codes: {
    NOT_CONFIGURED: 'vercel.not_configured',
    NOT_CONNECTED: 'vercel.not_connected',
    TOKEN_INVALID: 'vercel.token_invalid',
    TOKEN_EXPIRED: 'vercel.token_expired',
    SCOPE_DENIED: 'vercel.scope_denied',
    FORBIDDEN: 'vercel.forbidden',
    RATE_LIMITED: 'vercel.rate_limited',
    API_ERROR: 'vercel.api_error',
    SERVER_ERROR: 'vercel.server_error',
    NETWORK_ERROR: 'vercel.network_error',
    NOT_FOUND: 'vercel.not_found',
    INVALID_PROJECT: 'vercel.invalid_project',
    INVALID_DEPLOYMENT: 'vercel.invalid_deployment',
  },
  retryable: ['vercel.rate_limited', 'vercel.server_error', 'vercel.network_error'],
  info: {
    'vercel.not_configured': {
      title: 'Vercel connector is not configured',
      retryable: false,
      public: true,
      action:
        'Set vercel.token in config.toml or OMNICODE_VERCEL_TOKEN, then connect the connector.',
    },
    'vercel.not_connected': {
      title: 'Vercel is not connected',
      retryable: false,
      public: true,
      action: 'Connect a Vercel access token before using Vercel tools.',
    },
    'vercel.token_invalid': {
      title: 'Vercel rejected the access token',
      retryable: false,
      public: true,
      action: 'Create a new Vercel access token and connect the connector again.',
    },
    'vercel.token_expired': {
      title: 'Vercel access token expired',
      retryable: false,
      public: true,
      action: 'Connect the Vercel connector again with a fresh access token.',
    },
    'vercel.scope_denied': {
      title: 'Vercel token is out of scope',
      retryable: false,
      public: true,
      action: 'Target a project that belongs to the account or team the token is authorized for.',
    },
    'vercel.forbidden': {
      title: 'Vercel denied the request',
      retryable: false,
      public: true,
      action: 'Check that the token may access this account, team and project.',
    },
    'vercel.rate_limited': {
      title: 'Vercel rate limit reached',
      retryable: true,
      public: true,
      action: 'Wait for the reported reset window before retrying.',
    },
    'vercel.api_error': {
      title: 'Vercel request failed',
      retryable: false,
      public: true,
      action: 'Inspect the request parameters and try again.',
    },
    'vercel.server_error': {
      title: 'Vercel server error',
      retryable: true,
      public: true,
      action: 'Retry after a short delay.',
    },
    'vercel.network_error': {
      title: 'Vercel request failed to reach the API',
      retryable: true,
      public: true,
      action: 'Check network connectivity and retry.',
    },
    'vercel.not_found': {
      title: 'Vercel resource not found',
      retryable: false,
      public: true,
      action: 'Check the project or deployment identifier and the token scope.',
    },
    'vercel.invalid_project': {
      title: 'Invalid Vercel project',
      retryable: false,
      public: true,
      action: 'Use the project name or the prj_ identifier.',
    },
    'vercel.invalid_deployment': {
      title: 'Invalid Vercel deployment',
      retryable: false,
      public: true,
      action: 'Use the dpl_ identifier or the deployment URL.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(VercelErrors);

export type VercelErrorCode = (typeof VercelErrors.codes)[keyof typeof VercelErrors.codes];

export interface VercelErrorOptions {
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class VercelError extends Error {
  readonly code: VercelErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: VercelErrorCode, message: string, options?: VercelErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'VercelError';
    this.code = code;
    this.details = options?.details;
  }
}

export function isVercelError(error: unknown): error is VercelError {
  return error instanceof VercelError;
}

const VERCEL_TOKEN_PATTERN = /\b(?:vcp|vcsec)_[A-Za-z0-9_-]{16,}\b|\b[A-Za-z0-9]{24}\b/g;

export function redactVercelSecrets(text: string): string {
  return text.replace(VERCEL_TOKEN_PATTERN, '[REDACTED]');
}
