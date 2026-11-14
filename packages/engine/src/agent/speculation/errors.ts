import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const SpeculationErrors = {
  codes: {
    SPECULATION_BRANCH_ACTIVE: 'speculation.branch_active',
    SPECULATION_LOOP_BUSY: 'speculation.loop_busy',
    SPECULATION_NO_BRANCH: 'speculation.no_branch',
  },
  info: {
    'speculation.branch_active': {
      title: 'A speculative branch is already active',
      retryable: false,
      public: true,
      action: 'Accept or discard the active speculative branch before starting another one.',
    },
    'speculation.loop_busy': {
      title: 'Agent is busy; a speculative follow-up cannot start',
      retryable: false,
      public: true,
      action: 'Wait for the current turn to finish, then start the speculative follow-up.',
    },
    'speculation.no_branch': {
      title: 'No speculative branch is active',
      retryable: false,
      public: true,
      action: 'Start a speculative branch first.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(SpeculationErrors);
