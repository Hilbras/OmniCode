import { isError2 } from '@hilbras/omnicode-core';
import {
  ErrorCodes,
  isOmnicodeErrorCode,
  normalizeWorkDir,
  OmnicodeError,
  type OmnicodeErrorCode,
} from '@hilbras/omnicode-sdk/rpc-exports';

/**
 * Domain-neutral helpers extracted from the v1 request handler (WS2.4).
 * The wire contract is unchanged: these are the same validations and error
 * restatements, moved out of the 3.1k-line handler so they can be tested
 * directly and the handler can be split by domain later.
 */
export function normalizeRequiredWorkDir(operation: string, workDir: string): string {
  if (typeof workDir !== 'string' || workDir.trim() === '') {
    throw new OmnicodeError(ErrorCodes.REQUEST_WORK_DIR_REQUIRED, `${operation} requires workDir`);
  }
  return normalizeWorkDir(workDir);
}

export function restateEngineError(error: unknown): unknown {
  if (!isError2(error)) return error;
  const code: OmnicodeErrorCode = isOmnicodeErrorCode(error.code)
    ? error.code
    : ErrorCodes.INTERNAL;
  return new OmnicodeError(code, error.message, {
    details: error.details as Record<string, unknown> | undefined,
    cause: error.cause,
  });
}
