/**
 * The SDK rpc client's event pump delivers an engine event to every
 * registered listener. A listener that throws must not stop the others from
 * seeing the event, and must not take the pump down with it.
 */

import { describe, expect, it } from 'vitest';

import type { Event } from '#/events';
import { SDKRpcClientBase } from '#/rpc';

type WithListeners = { eventListeners: Set<(event: Event) => void> };

function clientWith(listeners: readonly ((event: Event) => void)[]): SDKRpcClientBase {
  const client = Object.create(SDKRpcClientBase.prototype) as SDKRpcClientBase;
  (client as unknown as WithListeners).eventListeners = new Set(listeners);
  return client;
}

const EVENT = { type: 'test.event' } as unknown as Event;

describe('SDKRpcClientBase event delivery', () => {
  it('delivers an event to every listener', () => {
    const seen: string[] = [];
    const client = clientWith([
      () => {
        seen.push('first');
      },
      () => {
        seen.push('second');
      },
    ]);

    client.receiveEvent(EVENT);

    expect(seen).toEqual(['first', 'second']);
  });

  it('keeps delivering to the other listeners when one throws', () => {
    const seen: string[] = [];
    const client = clientWith([
      () => {
        throw new Error('listener exploded');
      },
      () => {
        seen.push('second');
      },
    ]);

    expect(() => client.receiveEvent(EVENT)).not.toThrow();
    expect(seen).toEqual(['second']);
  });

  it('keeps delivering when a listener unsubscribes during the event', () => {
    const seen: string[] = [];
    const listeners = new Set<(event: Event) => void>();
    const client = Object.create(SDKRpcClientBase.prototype) as SDKRpcClientBase;
    (client as unknown as WithListeners).eventListeners = listeners;
    const unsubscribe = client.onEvent(() => {
      unsubscribe();
    });
    client.onEvent(() => {
      seen.push('second');
    });

    client.receiveEvent(EVENT);

    expect(seen).toEqual(['second']);
  });
});
