/**
 * The typed event surface every klient handle exposes: one listener per
 * registered event name, plus an error lane for validation failures and
 * listener exceptions. The `EventHub` implementation lives in
 * `@hilbras/omnicode-api`; this is only the shape.
 */

import type { KlientEventPayloads } from './contract/global/events.js';
import type { IDisposable } from '@hilbras/omnicode-rpc/channel';

export interface KlientEvents<TPayloadMap extends object = KlientEventPayloads> {
  on<E extends keyof TPayloadMap & string>(
    event: E,
    listener: (payload: TPayloadMap[E]) => void,
  ): IDisposable;
  /** Validation failures and listener exceptions surface here. */
  onError(listener: (error: Error) => void): IDisposable;
}
