import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import { type AgentTool } from '@hilbras/omnicode-core/tool/toolContract';

export const SelectToolsInputSchema = z
  .object({
    names: z
      .array(z.string())
      .min(1)
      .describe('Exact tool names to load, taken from the latest announced tool list.'),
  })
  .strict();

export type SelectToolsInput = z.infer<typeof SelectToolsInputSchema>;

export interface ISelectToolsTool extends AgentTool<SelectToolsInput> { readonly _serviceBrand: undefined }
export const ISelectToolsTool = createDecorator<ISelectToolsTool>('selectToolsTool');
