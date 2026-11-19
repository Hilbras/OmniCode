/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import { z } from 'zod';

import { AgentEvent2 } from '#/app/event/event2';
import { defineState } from '#/state/state';

import type { WorldState } from './worldState';

const valueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string()).readonly(),
]);
const stateSchema = z.record(z.string(), valueSchema);

const renderedSchema = z
  .object({
    agentId: z.string(),
    baseline: stateSchema,
    version: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Durable record of the world-state section baseline the model last rendered
 * (WS4.4). Replaying it restores the diff lineage after a session restart, so
 * a fresh process emits only changed fragments instead of a full section.
 * Compaction resets the lineage through a full render.
 */
export class WorldStateSectionRendered extends AgentEvent2<z.infer<typeof renderedSchema>> {
  static override readonly type = 'world_state.section_rendered';
  static override readonly durable = true;
  static override readonly schema = renderedSchema;
}
export interface WorldStateSectionRendered {
  readonly agentId: string;
  readonly baseline: WorldState;
  readonly version: number;
}

export const worldStateBaselineKey = defineState<{
  readonly value: WorldState;
  readonly version: number;
} | undefined>('worldState.baseline', () => undefined)
  .replayable({ schema: z.custom<{ readonly value: WorldState; readonly version: number } | undefined>() })
  .on(WorldStateSectionRendered, (_state, event) => ({
    value: event.baseline,
    version: event.version,
  }));
