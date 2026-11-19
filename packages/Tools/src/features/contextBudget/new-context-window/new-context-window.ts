import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

export const NEW_CONTEXT_WINDOW_TOOL_NAME = 'NewContextWindow' as const;

export const NewContextWindowInputSchema = z
  .object({
    /**
     * Optional guidance for what the summarized context must preserve, in the
     * caller's words. Kept short on purpose: it is carried into the compaction
     * instruction verbatim.
     */
    instruction: z.string().max(2_000).optional(),
  })
  .strict();
export type NewContextWindowInput = z.infer<typeof NewContextWindowInputSchema>;

export interface INewContextWindowTool extends AgentTool<NewContextWindowInput> {
  readonly _serviceBrand: undefined;
}

export const INewContextWindowTool = createDecorator<INewContextWindowTool>(
  'newContextWindowTool',
);
