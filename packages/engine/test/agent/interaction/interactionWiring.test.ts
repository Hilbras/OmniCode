import { describe, expect, it } from 'vitest';

import { InteractionRequestEvent } from '#/agent/interaction/interactionOps';
import {
  attachInteractionAgent,
  detachInteractionAgent,
} from '#/agent/interaction/interactionWiring';
import {
  INTERACTION_TAG_AGENT_ID,
  INTERACTION_TAG_SESSION_ID,
} from '#/human/interaction/interaction';
import { interactions } from '#/human/interaction/facade';

describe('interaction wiring', () => {
  it('dispatches an observable interaction.request event', async () => {
    const events: unknown[] = [];
    attachInteractionAgent('agent-test', 'session-test', {
      dispatch: async (event: unknown) => {
        events.push(event);
      },
    } as never);

    const pending = interactions.request({
      id: 'i-test',
      kind: 'question',
      payload: { questions: [] },
      tags: {
        [INTERACTION_TAG_AGENT_ID]: 'agent-test',
        [INTERACTION_TAG_SESSION_ID]: 'session-test',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event = events.find((item) => item instanceof InteractionRequestEvent);
    expect(event).toBeDefined();
    expect(InteractionRequestEvent.observable).toBe(true);

    interactions.respond('i-test', { answers: {} });
    await pending;
    detachInteractionAgent('agent-test', 'session-test');
  });
});
