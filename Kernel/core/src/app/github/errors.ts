import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';

export const GitHubErrors = {
  codes: {
    NOT_CONFIGURED: 'github.not_configured',
    NOT_CONNECTED: 'github.not_connected',
    TOKEN_EXPIRED: 'github.token_expired',
    TOKEN_REVOKED: 'github.token_revoked',
    SCOPE_DENIED: 'github.scope_denied',
    RATE_LIMITED: 'github.rate_limited',
    API_ERROR: 'github.api_error',
    SERVER_ERROR: 'github.server_error',
    NETWORK_ERROR: 'github.network_error',
    NOT_FOUND: 'github.not_found',
    INVALID_REPOSITORY: 'github.invalid_repository',
    DEVICE_FLOW_FAILED: 'github.device_flow_failed',
    DEVICE_FLOW_PENDING: 'github.device_flow_pending',
    DEVICE_FLOW_SLOW_DOWN: 'github.device_flow_slow_down',
    DEVICE_FLOW_EXPIRED: 'github.device_flow_expired',
    DEVICE_FLOW_DENIED: 'github.device_flow_denied',
    DEVICE_FLOW_NOT_FOUND: 'github.device_flow_not_found',
  },
  retryable: ['github.rate_limited', 'github.server_error', 'github.network_error'],
  info: {
    'github.not_configured': {
      title: 'GitHub connector is not configured',
      retryable: false,
      public: true,
      action: 'Set github.clientId in config.toml or OMNICODE_GITHUB_CLIENT_ID.',
    },
    'github.not_connected': {
      title: 'GitHub is not connected',
      retryable: false,
      public: true,
      action: 'Run the GitHub connect flow to authorize an account.',
    },
    'github.token_expired': {
      title: 'GitHub authorization expired',
      retryable: false,
      public: true,
      action: 'Reconnect GitHub to obtain a fresh authorization.',
    },
    'github.token_revoked': {
      title: 'GitHub authorization was revoked',
      retryable: false,
      public: true,
      action: 'Reconnect GitHub to authorize the account again.',
    },
    'github.scope_denied': {
      title: 'GitHub authorization is out of scope',
      retryable: false,
      public: true,
      action: 'Reconnect with broader scopes, or target a repository the grant covers.',
    },
    'github.rate_limited': {
      title: 'GitHub rate limit reached',
      retryable: true,
      public: true,
      action: 'Wait for the reported reset window before retrying.',
    },
    'github.api_error': {
      title: 'GitHub request failed',
      retryable: false,
      public: true,
      action: 'Inspect the request parameters and try again.',
    },
    'github.server_error': {
      title: 'GitHub server error',
      retryable: true,
      public: true,
      action: 'Retry after a short delay.',
    },
    'github.network_error': {
      title: 'GitHub request failed to reach the API',
      retryable: true,
      public: true,
      action: 'Check network connectivity and retry.',
    },
    'github.not_found': {
      title: 'GitHub resource not found',
      retryable: false,
      public: true,
      action: 'Check the repository, number, and authorization scope.',
    },
    'github.invalid_repository': {
      title: 'Invalid GitHub repository',
      retryable: false,
      public: true,
      action: 'Use the "owner/name" form.',
    },
    'github.device_flow_failed': {
      title: 'GitHub device flow failed',
      retryable: false,
      public: true,
      action: 'Start a new device flow and try again.',
    },
    'github.device_flow_pending': {
      title: 'GitHub authorization is still pending',
      retryable: true,
      public: true,
      action: 'Ask the user to finish approving the device code, then poll again.',
    },
    'github.device_flow_slow_down': {
      title: 'GitHub asked to slow down the device poll',
      retryable: true,
      public: true,
      action: 'Poll again after the requested interval.',
    },
    'github.device_flow_expired': {
      title: 'GitHub device code expired',
      retryable: false,
      public: true,
      action: 'Start a new device flow.',
    },
    'github.device_flow_denied': {
      title: 'GitHub authorization was denied',
      retryable: false,
      public: true,
      action: 'Start a new device flow if the denial was accidental.',
    },
    'github.device_flow_not_found': {
      title: 'GitHub authorization request is no longer available',
      retryable: false,
      public: true,
      action: 'Start the GitHub connection again to get a new device code.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(GitHubErrors);

export type GitHubErrorCode = (typeof GitHubErrors.codes)[keyof typeof GitHubErrors.codes];

export interface GitHubErrorOptions {
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: GitHubErrorCode, message: string, options?: GitHubErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GitHubError';
    this.code = code;
    this.details = options?.details;
  }
}

export function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof GitHubError;
}

const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g;

export function redactGitHubSecrets(text: string): string {
  return text.replace(GITHUB_TOKEN_PATTERN, '[REDACTED]');
}
