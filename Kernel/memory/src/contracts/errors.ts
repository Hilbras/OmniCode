import {
  type ErrorDomain,
  registerErrorDomain,
} from '@hilbras/omnicode-core/_base/errors/codes';
import { ExpectedError } from '@hilbras/omnicode-core/_base/errors/errors';

export const MemoryErrors = {
  codes: {
    STORAGE_UNAVAILABLE: 'memory.storage_unavailable',
    STORAGE_WRITE_FAILED: 'memory.storage_write_failed',
    CORRUPT_RECORD: 'memory.corrupt_record',
    SCHEMA_TOO_NEW: 'memory.schema_too_new',
    UNKNOWN_AUTHORITY: 'memory.unknown_authority',
    REVIEW_FAILED: 'memory.review_failed',
  },
  retryable: ['memory.storage_unavailable', 'memory.storage_write_failed'],
  info: {
    'memory.storage_unavailable': {
      title: 'Memory store unavailable',
      retryable: true,
      public: false,
      action: 'Memory retrieval is unavailable for this call; continue without it unless the task requires recall.',
    },
    'memory.storage_write_failed': {
      title: 'Memory write failed',
      retryable: true,
      public: false,
      action: 'The memory write was not durable. Nothing was stored, so it can safely be retried.',
    },
    'memory.corrupt_record': {
      title: 'Corrupt memory record',
      retryable: false,
      public: false,
      action: 'The record was skipped; run memory diagnostics to inspect stored records.',
    },
    'memory.schema_too_new': {
      title: 'Memory store written by a newer version',
      retryable: false,
      public: true,
      action: 'Upgrade Omnicode to open this memory store, or point OMNICODE_MEMORY_DIR at a different directory.',
    },
    'memory.unknown_authority': {
      title: 'Unrecognised memory authority',
      retryable: false,
      public: false,
      action: 'System-trusted memory requires an authority issued by the host application.',
    },
    'memory.review_failed': {
      title: 'Memory review failed',
      retryable: true,
      public: false,
      action: 'The queued review will be retried; the source capture is preserved.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(MemoryErrors);

export type MemoryErrorCode = (typeof MemoryErrors.codes)[keyof typeof MemoryErrors.codes];

export type MemoryErrorDetails = Readonly<Record<string, unknown>>;

export class MemoryError extends ExpectedError {
  readonly code: MemoryErrorCode;
  readonly details?: MemoryErrorDetails;

  constructor(
    code: MemoryErrorCode,
    message: string,
    options?: { readonly details?: MemoryErrorDetails; readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isMemoryError(error: unknown): error is MemoryError {
  return error instanceof MemoryError;
}