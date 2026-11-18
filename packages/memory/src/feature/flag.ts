import {
  type FlagDefinitionInput,
  registerFlagDefinition,
} from '@hilbras/omnicode-engine/app/flag/flagRegistry';

export const MEMORY_FLAG_ID = 'memory';
export const MEMORY_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY';

export const MEMORY_PREFERENCES_FLAG_ID = 'memory_preferences';
export const MEMORY_PREFERENCES_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_PREFERENCES';

export const MEMORY_AUTO_CAPTURE_FLAG_ID = 'memory_auto_capture';
export const MEMORY_AUTO_CAPTURE_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_AUTO_CAPTURE';

export const MEMORY_PHRASES_FLAG_ID = 'memory_phrases';
export const MEMORY_PHRASES_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_PHRASES';

export const MEMORY_PROFILE_FLAG_ID = 'memory_profile';
export const MEMORY_PROFILE_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_PROFILE';

export const MEMORY_WRITER_FLAG_ID = 'memory_writer';
export const MEMORY_WRITER_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY_WRITER';

export const memoryFlag: FlagDefinitionInput = {
  id: MEMORY_FLAG_ID,
  title: 'Memory',
  description:
    'Enable persistent memory: trust-gated capture, lexical retrieval with honest budgets, and resumable task state.',
  env: MEMORY_FLAG_ENV,
  default: true,
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

export const memoryAutoCaptureFlag: FlagDefinitionInput = {
  id: MEMORY_AUTO_CAPTURE_FLAG_ID,
  title: 'Memory auto-capture',
  description:
    'Opt-in fallback: automatically save explicit user memory requests such as "remember that ..." when the agent does not call memory_save.',
  env: MEMORY_AUTO_CAPTURE_FLAG_ENV,
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

export const memoryProfileFlag: FlagDefinitionInput = {
  id: MEMORY_PROFILE_FLAG_ID,
  title: 'Memory profile',
  description:
    'Capture explicit user profile statements (name, preferred address, location, timezone) as trusted context and inject them into every turn.',
  env: MEMORY_PROFILE_FLAG_ENV,
  default: true,
  surface: 'both',
};

registerFlagDefinition(memoryFlag);
registerFlagDefinition(memoryPreferencesFlag);
registerFlagDefinition(memoryAutoCaptureFlag);
export const memoryWriterFlag: FlagDefinitionInput = {
  id: MEMORY_WRITER_FLAG_ID,
  title: 'Memory writer',
  description:
    'After a turn, ask the model what is worth remembering, and store only proposals anchored to a verbatim quote from the user.',
  env: MEMORY_WRITER_FLAG_ENV,
  default: true,
  surface: 'both',
};

registerFlagDefinition(memoryPhrasesFlag);
registerFlagDefinition(memoryProfileFlag);
registerFlagDefinition(memoryWriterFlag);