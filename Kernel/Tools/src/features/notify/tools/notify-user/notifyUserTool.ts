import { registerAgentToolService } from '@hilbras/omnicode-core/agent/toolRegistry/toolContribution';

import { IAgentContextMemoryService } from '@hilbras/omnicode-core/agent/contextMemory/contextMemory';
import { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import { ITelemetryService } from '@hilbras/omnicode-core/app/telemetry/telemetry';
import { toInputJsonSchema } from '@hilbras/omnicode-core/tool/input-schema';
import { ToolAccesses, type ToolExecution } from '@hilbras/omnicode-core/tool/toolContract';
import { notifyUserAvailable } from '@hilbras/omnicode-core/features/notify/notifyUserAvailability';
import { ISessionNotify } from '@hilbras/omnicode-core/features/notify/sessionNotify';
import { notifyStreakBefore } from '@hilbras/omnicode-core/features/notify/notifyUserNudge';

import {
  INotifyUserTool,
  NOTIFY_USER_TOOL_NAME,
  NotifyUserInputSchema,
  type NotifyUserInput,
} from './notify-user';
import DESCRIPTION from './notify-user.md?raw';

export const NOTIFY_USER_DELIVERED_OUTPUT = 'Update shown to the user.';
export const NOTIFY_USER_EMPTY_MESSAGE = 'message must not be empty.';
export const NOTIFY_USER_SUPPRESSED_OUTPUT = 'Notifications are disabled; the update was not displayed.';

export class NotifyUserTool implements INotifyUserTool {
  declare readonly _serviceBrand: undefined;
  readonly name = NOTIFY_USER_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(NotifyUserInputSchema);

  constructor(
    @IFlagService private readonly flags: IFlagService,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @ITelemetryService private readonly telemetry: ITelemetryService,
  ) {}

  resolveExecution(args: NotifyUserInput): ToolExecution {
    if (args.message.trim().length === 0) {
      return { isError: true, output: NOTIFY_USER_EMPTY_MESSAGE };
    }
    return {
      description: 'Notifying the user',
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      execute: async ({ turnId, toolCallId }) => {
        const displayed = notifyUserAvailable(this.flags, this.bootstrap);
        const streak = notifyStreakBefore(this.context.get(), toolCallId);
        this.telemetry.track2('notify_user_sent', {
          turn_id: turnId,
          rounds_since_notify: streak.rounds,
          after_nudge: streak.nudges > 0,
          message_chars: args.message.length,
          displayed,
        });
        return displayed
          ? { isError: false, output: NOTIFY_USER_DELIVERED_OUTPUT }
          : { isError: false, output: NOTIFY_USER_SUPPRESSED_OUTPUT };
      },
    };
  }
}

registerAgentToolService(INotifyUserTool, NotifyUserTool, {
  name: NOTIFY_USER_TOOL_NAME,
  domain: 'notify',
  when: (accessor) => accessor.get(ISessionNotify).enabled,
});
