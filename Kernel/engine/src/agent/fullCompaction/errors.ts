import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const FullCompactionErrors = {
  codes: {
    COMPACTION_FAILED: 'compaction.failed',
    COMPACTION_UNABLE: 'compaction.unable',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(FullCompactionErrors);
