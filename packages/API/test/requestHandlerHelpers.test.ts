import { describe, expect, it } from 'vitest';

import { Error2 } from '@hilbras/omnicode-base/errors/errors';
import { ErrorCodes, isOmnicodeError } from '@hilbras/omnicode-sdk/rpc-exports';
import {
  normalizeRequiredWorkDir,
  restateEngineError,
} from '../src/requestHandlerHelpers';

describe('normalizeRequiredWorkDir', () => {
  it('rejects an empty workDir with the request-level code', () => {
    expect(() => normalizeRequiredWorkDir('createSession', '   ')).toThrow(
      /createSession requires workDir/,
    );
    try {
      normalizeRequiredWorkDir('createSession', '');
    } catch (error) {
      expect(isOmnicodeError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ErrorCodes.REQUEST_WORK_DIR_REQUIRED);
    }
  });
});

describe('restateEngineError', () => {
  it('passes non-Error2 failures through untouched', () => {
    const plain = new Error('plain');
    expect(restateEngineError(plain)).toBe(plain);
  });

  it('restates a known engine code as a public OmnicodeError', () => {
    const cause = new Error('root');
    const engineError = new Error2(ErrorCodes.SESSION_NOT_FOUND, 'missing', {
      details: { id: 's1' }, cause,
    });
    const restated = restateEngineError(engineError) as Error & { code: string };
    expect(isOmnicodeError(restated)).toBe(true);
    expect(restated.message).toBe('missing');
    expect(restated.code).toBe(ErrorCodes.SESSION_NOT_FOUND);
    expect(restated.cause).toBe(cause);
  });

  it('restates an unknown engine code as internal', () => {
    const restated = restateEngineError(new Error2('new_engine_code' as never, 'new')) as Error & {
      code: string;
    };
    expect(restated.code).toBe(ErrorCodes.INTERNAL);
  });
});
