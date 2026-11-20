import type { ApprovalHandler, ApprovalRequest, ApprovalResponse } from '@hilbras/omnicode-api';

import { adaptApprovalRequest } from './adapter';
import type { ApprovalController } from './controller';

export function createApprovalRequestHandler(
  controller: ApprovalController,
  onResponse?: (request: ApprovalRequest, response: ApprovalResponse) => void,
): ApprovalHandler {
  return async (event): Promise<ApprovalResponse> => {
    try {
      const response = await controller.show(adaptApprovalRequest(event));
      // The promise also settles when the interaction was answered on another
      // surface (e.g. Telegram); the kernel no-ops the duplicate respond, and
      // the local transcript entry would wrongly read "Cancelled".
      if (controller.consumeExternalResolution() !== undefined) return response;
      onResponse?.(event, response);
      return response;
    } catch {
      const response: ApprovalResponse = {
        decision: 'cancelled',
        feedback: 'approval handler failed',
      };
      onResponse?.(event, response);
      return response;
    }
  };
}
