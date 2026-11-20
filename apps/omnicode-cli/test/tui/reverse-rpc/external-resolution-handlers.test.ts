import { describe, expect, it, vi } from 'vitest';

import type { ApprovalRequest, QuestionRequest } from '@hilbras/omnicode-api';

import { createApprovalRequestHandler } from '#/tui/reverse-rpc/approval/handler';
import { ApprovalController } from '#/tui/reverse-rpc/approval/controller';
import { createQuestionAskHandler } from '#/tui/reverse-rpc/question/handler';
import { QuestionController } from '#/tui/reverse-rpc/question/controller';
import type { QuestionPanelResponse } from '#/tui/reverse-rpc/types';

const approvalRequest: ApprovalRequest = {
  toolCallId: 'call-1',
  toolName: 'Bash',
  action: 'run command',
  interactionId: 'i1',
  display: { kind: 'generic', summary: 'run command', detail: { command: 'ls' } },
};

const questionRequest: QuestionRequest & { readonly interactionId?: string | undefined } = {
  turnId: 1,
  toolCallId: 'call-2',
  interactionId: 'i2',
  questions: [{ question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
};

describe('reverse RPC handlers skip local bookkeeping for external answers', () => {
  it('approval handler does not report a local answer when resolved elsewhere', async () => {
    const controller = new ApprovalController();
    const onResponse = vi.fn();
    const handler = createApprovalRequestHandler(controller, onResponse);

    const pending = handler(approvalRequest);
    const resolved = controller.resolveExternally(
      (payload) => payload.interaction_id === 'i1',
      'answered-elsewhere',
    );
    expect(resolved?.interaction_id).toBe('i1');

    const response = await pending;
    expect(response.decision).toBe('cancelled');
    expect(onResponse).not.toHaveBeenCalled();
    expect(controller.consumeExternalResolution()).toBeUndefined();
  });

  it('approval handler still reports genuinely local answers', async () => {
    const controller = new ApprovalController();
    const onResponse = vi.fn();
    const handler = createApprovalRequestHandler(controller, onResponse);

    const pending = handler(approvalRequest);
    controller.respond({ decision: 'approved' });
    await pending;

    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it('question handler returns null for an external answer', async () => {
    const controller = new QuestionController();
    const handler = createQuestionAskHandler(controller);

    const pending = handler(questionRequest);
    const resolved = controller.resolveExternally(
      (payload) => payload.interaction_id === 'i2',
      'answered-elsewhere',
    );
    expect(resolved?.interaction_id).toBe('i2');

    await expect(pending).resolves.toBeNull();
    expect(controller.consumeExternalResolution()).toBeUndefined();
  });
});

describe('QuestionPanelResponse cancel shape', () => {
  it('createCancelResponse yields empty answers', () => {
    const controller = new QuestionController();
    const response: QuestionPanelResponse = controller['createCancelResponse']('test');
    expect(response.answers).toEqual([]);
  });
});
