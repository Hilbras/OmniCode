import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const UsageErrors = {
  codes: {
    TURN_ID_CONFLICT: 'usage.turn_id_conflict',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(UsageErrors);
