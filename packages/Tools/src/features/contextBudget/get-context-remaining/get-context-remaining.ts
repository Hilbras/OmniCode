import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

export const GET_CONTEXT_REMAINING_TOOL_NAME = 'GetContextRemaining' as const;

export const GetContextRemainingInputSchema = z.object({}).strict();
export type GetContextRemainingInput = z.infer<typeof GetContextRemainingInputSchema>;

export interface IGetContextRemainingTool extends AgentTool<GetContextRemainingInput> {
  readonly _serviceBrand: undefined;
}

export const IGetContextRemainingTool = createDecorator<IGetContextRemainingTool>(
  'getContextRemainingTool',
);
