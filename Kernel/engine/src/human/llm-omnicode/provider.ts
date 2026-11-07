import { createProvider } from '#/llm/provider/definition';
import { anthropicBetaBase } from '#/llm/requester/bases/anthropic/requester';
import { openAIResponsesBase } from '#/llm/requester/bases/openai-responses/requester';
import { openAIBase } from '#/llm/requester/bases/openai/requester';

import { classifyOmnicodeQuotaError } from './errors';
import { omnicodeMediaContribution } from './media';
import {
  omnicodeAnthropicTrait,
  omnicodeConnection,
  omnicodeOpenAITrait,
  omnicodeResponsesTrait,
} from './trait';

export const omnicodeProvider = createProvider({
  id: 'omnicode',
  protocols: {
    openai: {
      base: openAIBase,
      trait: omnicodeOpenAITrait,
      connection: omnicodeConnection,
      classifyError: classifyOmnicodeQuotaError,
    },
    anthropic: {
      base: anthropicBetaBase,
      trait: omnicodeAnthropicTrait,
      connection: omnicodeConnection,
      classifyError: classifyOmnicodeQuotaError,
    },
    openai_responses: {
      base: openAIResponsesBase,
      trait: omnicodeResponsesTrait,
      connection: omnicodeConnection,
      classifyError: classifyOmnicodeQuotaError,
    },
  },
  media: omnicodeMediaContribution,
});
