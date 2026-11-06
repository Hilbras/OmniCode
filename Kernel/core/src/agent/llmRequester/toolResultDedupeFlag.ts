import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const TOOL_RESULT_DEDUPE_FLAG_ID = 'tool-result-dedupe';
export const TOOL_RESULT_DEDUPE_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_TOOL_RESULT_DEDUPE';

export const toolResultDedupeFlag: FlagDefinitionInput = {
  id: TOOL_RESULT_DEDUPE_FLAG_ID,
  title: 'Repeated tool-output deduplication',
  description:
    'When a tool returns the same output twice in one conversation, keep the first copy and replace the later one with a pointer to it. Nothing is lost: the earlier identical result stays in context.',
  env: TOOL_RESULT_DEDUPE_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(toolResultDedupeFlag);