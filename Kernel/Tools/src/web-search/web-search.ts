import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import { type AgentTool } from '@hilbras/omnicode-core/tool/toolContract';

export type {
  WebSearchProvider,
  WebSearchResult,
} from '@hilbras/omnicode-core/app/auth/webSearch/webSearchContract';
import type { WebSearchResult } from '@hilbras/omnicode-core/app/auth/webSearch/webSearchContract';

export const WebSearchInputSchema = z.object({
  query: z.string().describe('The query text to search for.'),
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

export interface IWebSearchTool extends AgentTool<WebSearchInput> {
  readonly _serviceBrand: undefined;
}
export const IWebSearchTool = createDecorator<IWebSearchTool>('webSearchTool');
