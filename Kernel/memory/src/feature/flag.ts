import {
  type FlagDefinitionInput,
  registerFlagDefinition,
} from '@hilbras/omnicode-core/app/flag/flagRegistry';

export const MEMORY_FLAG_ID = 'memory';
export const MEMORY_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY';

export const MEMORY_PREFERENCES_FLAG_ID = 'memory_preferences';
export const MEMORY_PREFERENCES_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_PREFERENCES';

export const MEMORY_PHRASES_FLAG_ID = 'memory_phrases';
export const MEMORY_PHRASES_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_PHRASES';

export const memoryFlag: FlagDefinitionInput = {
  id: MEMORY_FLAG_ID,
  title: 'Memory',
  description:
    'Enable persistent memory: trust-gated capture, lexical retrieval with honest budgets, and resumable task state.',
  env: MEMORY_FLAG_ENV,
  default: false,
  surface: 'both',
};

export const memoryPreferencesFlag: FlagDefinitionInput = {
  id: MEMORY_PREFERENCES_FLAG_ID,
  title: 'Memory preferences',
  description:
    'Learn durable user preferences from explicit statements and inject them as trusted context.',
  env: MEMORY_PREFERENCES_FLAG_ENV,
  default: false,
  surface: 'both',
};

export const memoryPhrasesFlag: FlagDefinitionInput = {
  id: MEMORY_PHRASES_FLAG_ID,
  title: 'Memory phrases',
  description:
    'Track the phrases the user repeats and inject them as vocabulary context.',
  env: MEMORY_PHRASES_FLAG_ENV,
  default: false,
  surface: 'both',
};

registerFlagDefinition(memoryFlag);
registerFlagDefinition(memoryPreferencesFlag);
registerFlagDefinition(memoryPhrasesFlag);