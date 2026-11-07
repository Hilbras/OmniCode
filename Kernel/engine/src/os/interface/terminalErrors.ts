import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const TerminalErrors = {
  codes: {
    TERMINAL_NOT_FOUND: 'terminal.not_found',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(TerminalErrors);
