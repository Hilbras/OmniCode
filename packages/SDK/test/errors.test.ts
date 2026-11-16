import { APIProviderFilteredError, APIStatusError } from '@hilbras/omnicode-llm';
import { describe, expect, it } from 'vitest';

import { ErrorCodes, toOmnicodeErrorPayload } from '#/errors';

describe('toOmnicodeErrorPayload — content filter', () => {
  it('maps a provider content filter to provider.filtered and marks it non-retryable', () => {
    const payload = toOmnicodeErrorPayload(
      new APIProviderFilteredError(422, 'input rejected by content safety screening', 'req-1'),
    );
    expect(payload.code).toBe(ErrorCodes.PROVIDER_FILTERED);
    expect(payload.retryable).toBe(false);
    expect(payload.details).toMatchObject({ statusCode: 422, requestId: 'req-1' });
  });

  it('leaves an unrelated 422 as provider.api_error', () => {
    const payload = toOmnicodeErrorPayload(new APIStatusError(422, 'invalid tool_use_id'));
    expect(payload.code).toBe(ErrorCodes.PROVIDER_API_ERROR);
  });
});
