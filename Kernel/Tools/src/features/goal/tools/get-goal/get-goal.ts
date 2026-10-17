import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import { type AgentTool } from '@hilbras/omnicode-core/tool/toolContract';

export const GetGoalToolInputSchema = z.object({}).strict();
export type GetGoalToolInput = z.infer<typeof GetGoalToolInputSchema>;

export interface IGetGoalTool extends AgentTool<GetGoalToolInput> { readonly _serviceBrand: undefined }
export const IGetGoalTool = createDecorator<IGetGoalTool>('getGoalTool');
