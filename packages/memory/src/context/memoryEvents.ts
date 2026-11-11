/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import { AgentEvent2 } from '@hilbras/omnicode-engine/app/event/event2';

import type { MemoryCategory, MemoryScopeTier, MemoryTrust } from '#/contracts/memoryTypes';

export interface MemorySavedPayload {
  readonly agentId: string;
  readonly memoryId: string;
  readonly content: string;
  readonly category: MemoryCategory;
  readonly trust: MemoryTrust;
  readonly scope: MemoryScopeTier;
}

export class MemorySaved extends AgentEvent2<MemorySavedPayload> {
  static override readonly type = 'memory.saved';
  static override readonly observable = true;
}
export interface MemorySaved extends MemorySavedPayload {}
