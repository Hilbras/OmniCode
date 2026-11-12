import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { Message } from '#/llm-adapter/contract/message';

import type { ContextMessage } from '#/agent/contextMemory/types';

import type { WorldStateRender } from './worldState';

declare const mediaStripSnapshotBrand: unique symbol;

export interface MediaStripSnapshot {
  readonly [mediaStripSnapshotBrand]: undefined;
}

export interface ProjectionPolicy {
  readonly structure?: 'strict';
  readonly media?: 'degraded' | { readonly strip: MediaStripSnapshot };
}

export interface IAgentContextProjectorService {
  readonly _serviceBrand: undefined;

  project(
    messages: readonly ContextMessage[],
    policy?: ProjectionPolicy,
    mediaPaths?: ReadonlyMap<string, string>,
  ): readonly Message[];
  captureMediaStripSnapshot(messages: readonly ContextMessage[]): MediaStripSnapshot;

  /** Transition-only world-state section; caller supplies the current state. */
  renderWorldState(state: unknown): WorldStateRender;

  /** Full world-state re-render scheduled for the next call (post-compaction). */
  resetWorldStateBaseline(): void;

  worldStateText(state: unknown): string;
}

export const IAgentContextProjectorService = createDecorator<IAgentContextProjectorService>(
  'agentContextProjectorService',
);
