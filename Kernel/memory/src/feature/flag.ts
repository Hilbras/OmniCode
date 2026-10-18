import {
  type FlagDefinitionInput,
  registerFlagDefinition,
} from '@hilbras/omnicode-core/app/flag/flagRegistry';

export const MEMORY_FLAG_ID = 'memory';
export const MEMORY_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_MEMORY';

export const memoryFlag: FlagDefinitionInput = {
  id: MEMORY_FLAG_ID,
  title: 'Memory',
  description:
    'Enable persistent memory: trust-gated capture, lexical retrieval with honest budgets, and resumable task state.',
  env: MEMORY_FLAG_ENV,
  default: false,
  surface: 'both',
};

registerFlagDefinition(memoryFlag);