import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-core/tool/toolContract';

export const EnterPlanModeInputSchema = z.object({}).strict();
export type EnterPlanModeInput = z.infer<typeof EnterPlanModeInputSchema>;

export interface IEnterPlanModeTool extends AgentTool<EnterPlanModeInput> {
  readonly _serviceBrand: undefined;
}
export const IEnterPlanModeTool = createDecorator<IEnterPlanModeTool>('enterPlanModeTool');
