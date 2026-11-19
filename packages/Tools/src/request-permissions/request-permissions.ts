import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { type AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

export const RequestPermissionsInputSchema = z
  .object({
    rules: z
      .array(
        z
          .object({
            decision: z.enum(['allow', 'deny', 'ask']),
            scope: z.enum(['turn-override', 'session-runtime']),
            pattern: z.string().min(1).describe('Tool name or tool(args) pattern.'),
            reason: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type RequestPermissionsInput = z.infer<typeof RequestPermissionsInputSchema>;

export interface IRequestPermissionsTool extends AgentTool<RequestPermissionsInput> {
  readonly _serviceBrand: undefined;
}
export const IRequestPermissionsTool = createDecorator<IRequestPermissionsTool>(
  'requestPermissionsTool',
);
