import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const TOOL_RESULT_COMPRESSION_FLAG_ID = 'tool-result-compression';
export const TOOL_RESULT_COMPRESSION_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_TOOL_RESULT_COMPRESSION';

export const toolResultCompressionFlag: FlagDefinitionInput = {
  id: TOOL_RESULT_COMPRESSION_FLAG_ID,
  title: 'Structured tool-output compression',
  description:
    'Keep the schema and identifiers of large JSON tool output instead of a head and tail preview. The original still spills to a file and stays retrievable.',
  env: TOOL_RESULT_COMPRESSION_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(toolResultCompressionFlag);