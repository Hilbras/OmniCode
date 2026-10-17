export { NOTIFY_USER_TOOL_NAME } from '@hilbras/omnicode-core/features/notify/notifyToolName';
import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import { type AgentTool } from '@hilbras/omnicode-core/tool/toolContract';


export interface NotifyUserInput {
  message: string;
}

export const NotifyUserInputSchema: z.ZodType<NotifyUserInput> = z.object({
  message: z
    .string()
    .min(1)
    .describe(
      "The update to show the user: a short intro paragraph followed by a few bullet points of light Markdown, in the user's language, under ~1000 characters.",
    ),
});

export interface INotifyUserTool extends AgentTool<NotifyUserInput> {
  readonly _serviceBrand: undefined;
}
export const INotifyUserTool = createDecorator<INotifyUserTool>('notifyUserTool');
