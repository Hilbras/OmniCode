import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const WebErrors = {
  codes: {
    WEB_INVALID_URL: 'web.invalid_url',
    WEB_PRIVATE_ADDRESS: 'web.private_address',
    WEB_FETCH_FAILED: 'web.fetch_failed',
  },
  retryable: ['web.fetch_failed'],
} as const satisfies ErrorDomain;

registerErrorDomain(WebErrors);
