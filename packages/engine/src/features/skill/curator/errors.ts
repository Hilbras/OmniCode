import { registerErrorDomain, type ErrorDomain } from '@hilbras/omnicode-base/errors/codes';

export const SkillCuratorErrors = {
  codes: {
    SKILL_CURATOR_STATE_INVALID: 'skill.curator_state_invalid',
    SKILL_CURATOR_STATE_TOO_LARGE: 'skill.curator_state_too_large',
    SKILL_CURATOR_USAGE_INVALID: 'skill.curator_usage_invalid',
    SKILL_CURATOR_OPTIONS_INVALID: 'skill.curator_options_invalid',
    SKILL_CURATOR_SET_NAME_INVALID: 'skill.curator_set_name_invalid',
    SKILL_CURATOR_SET_NOT_FOUND: 'skill.curator_set_not_found',
  },
  info: {
    'skill.curator_state_invalid': {
      title: 'Curator state is invalid',
      retryable: false,
      public: true,
      action: 'Inspect or delete the curator state document; it is not valid JSON for its shape.',
    },
    'skill.curator_state_too_large': {
      title: 'Curator state exceeds the read cap',
      retryable: false,
      public: true,
      action: 'Curator state is bounded metadata; remove or shrink the oversized document.',
    },
    'skill.curator_set_name_invalid': {
      title: 'Curated set name is invalid',
      retryable: false,
      public: true,
      action: 'Use a name matching [a-z0-9][a-z0-9._-]*.',
    },
    'skill.curator_set_not_found': {
      title: 'Curated set not found',
      retryable: false,
      public: true,
      action: 'List the curated sets to see which names exist.',
    },
  },
} as const satisfies ErrorDomain;

registerErrorDomain(SkillCuratorErrors);
