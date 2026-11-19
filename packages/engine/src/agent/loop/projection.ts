import type { PromptOrigin } from '#/agent/contextMemory/types';
import type { ContextMessage } from '#/agent/contextMemory/types';
import type { UserEntry } from '#human/agent/turn';

/**
 * Machine-event projection helpers (WS2.2, final collaborator).
 *
 * Pure shape mapping from the machine's queued user entries to the prompt
 * projection the loop dispatches. Keeping it out of AgentLoopService makes the
 * mapping testable and stops the service from owning data-shaping details.
 */
export interface PromptProjection {
  readonly tracked: boolean;
  readonly origin: PromptOrigin;
  readonly message: ContextMessage;
  readonly userMessageId: string;
  readonly createdAt: string;
}

export const EMPTY_HANDLE_MESSAGE: ContextMessage = {
  role: 'user',
  content: [],
  toolCalls: [],
};

export function projectionFromEntry(entry: UserEntry): PromptProjection {
  const origin = (entry.meta?.origin as PromptOrigin | undefined) ?? { kind: 'user' };
  return {
    tracked: entry.meta?.tracked === true,
    origin,
    message: {
      role: 'user',
      content: [...entry.message.content],
      id: entry.meta?.promptId,
      toolCalls: [],
      origin: entry.meta?.origin as PromptOrigin | undefined,
    },
    userMessageId: entry.meta?.userMessageId ?? '',
    createdAt: entry.meta?.createdAt ?? '',
  };
}
