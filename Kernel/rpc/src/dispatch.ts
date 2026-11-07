import type { ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

import type { EventSourceRef, IDisposable, ScopeRef } from './channel.js';
import { RPCError } from './errors.js';

const REQUEST_INVALID = 40001;

export interface ScopeLike {
  readonly accessor: {
    get<T>(id: ServiceIdentifier<T>): T;
  };
}

export interface ResolvedScope {
  readonly kind: string;
  readonly like: ScopeLike;
  readonly sessionId?: string;
}

export function wireClone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface Dispatcher {
  call(scope: ScopeRef, service: string, method: string, args: unknown[]): Promise<unknown>;
  stream(scope: ScopeRef, service: string, method: string, args: unknown[]): AsyncIterable<unknown>;
  listen(
    scope: ScopeRef,
    source: EventSourceRef,
    handler: (data: unknown) => void,
    onError?: (error: Error) => void,
  ): IDisposable;
}

export interface DispatchHost {
  resolveScope(scope: ScopeRef): Promise<ResolvedScope>;
  resolveService(resolved: ResolvedScope, service: string): Record<string, unknown>;
  subscribe(resolved: ResolvedScope, name: string, handler: (data: unknown) => void): IDisposable;
  handleCall?(
    resolved: ResolvedScope,
    service: string,
    method: string,
    args: unknown[],
    instance: Record<string, unknown>,
  ): Promise<{ readonly handled: true; readonly value: unknown } | { readonly handled: false }>;
  streamIterable?(
    resolved: ResolvedScope,
    service: string,
    method: string,
    args: unknown[],
    instance: Record<string, unknown>,
  ): AsyncIterable<unknown> | undefined;
  adaptCallArgs?(resolved: ResolvedScope, service: string, args: unknown[]): unknown[];
  mapCallError?(service: string, error: unknown): void;
}

function subscribeSource(
  host: DispatchHost,
  resolved: ResolvedScope,
  source: EventSourceRef,
  handler: (data: unknown) => void,
): IDisposable {
  if (source.kind === 'stream') {
    return host.subscribe(resolved, source.name, handler);
  }
  if (!/^on[A-Z]/.test(source.event)) {
    throw new RPCError(REQUEST_INVALID, `not an event property: ${source.event}`);
  }
  const instance = host.resolveService(resolved, source.service);
  const emitter = instance[source.event];
  if (typeof emitter !== 'function') {
    throw new RPCError(REQUEST_INVALID, `event not found: ${source.service}.${source.event}`);
  }
  return (emitter as (listener: (data: unknown) => void) => IDisposable).call(instance, (data) => {
    handler(wireClone(data));
  });
}

function streamIterable(
  host: DispatchHost,
  resolved: ResolvedScope,
  service: string,
  method: string,
  args: unknown[],
  instance: Record<string, unknown>,
): AsyncIterable<unknown> {
  const special = host.streamIterable?.(resolved, service, method, args, instance);
  if (special !== undefined) return special;
  const member = instance[method];
  if (member === undefined) {
    throw new RPCError(REQUEST_INVALID, `method not found: ${service}.${method}`);
  }
  if (typeof member !== 'function') {
    throw new RPCError(REQUEST_INVALID, `not a streaming method: ${service}.${method}`);
  }
  const clonedArgs = args.map(wireClone);
  return (member as (...a: unknown[]) => unknown).apply(instance, clonedArgs) as AsyncIterable<unknown>;
}

function bridgeIterable(start: () => Promise<AsyncIterator<unknown>>, abort?: () => void): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let source: AsyncIterator<unknown> | undefined;
      let started: Promise<void> | undefined;
      const ensureStarted = (): Promise<void> => {
        started ??= start().then((iterator) => {
          source = iterator;
        });
        return started;
      };
      return {
        async next() {
          await ensureStarted();
          const result = await source!.next();
          if (result.done) return { done: true, value: undefined };
          return { done: false, value: wireClone(result.value) };
        },
        async return(value?: unknown) {
          abort?.();
          await source?.return?.(value);
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

export function createDispatcher(host: DispatchHost): Dispatcher {
  return {
    async call(scope, service, method, args) {
      const resolved = await host.resolveScope(scope);
      const instance = host.resolveService(resolved, service);
      const special = await host.handleCall?.(resolved, service, method, args, instance);
      if (special !== undefined && special.handled) return special.value;
      const member = instance[method];
      if (member === undefined) {
        throw new RPCError(REQUEST_INVALID, `method not found: ${service}.${method}`);
      }
      if (typeof member !== 'function') {
        return wireClone(member);
      }
      const clonedArgs = host.adaptCallArgs?.(resolved, service, args) ?? args.map(wireClone);
      try {
        const result = await (member as (...a: unknown[]) => unknown).apply(instance, clonedArgs);
        return wireClone(result);
      } catch (error) {
        host.mapCallError?.(service, error);
        throw error;
      }
    },

    stream(scope, service, method, args): AsyncIterable<unknown> {
      return bridgeIterable(async () => {
        const resolved = await host.resolveScope(scope);
        const instance = host.resolveService(resolved, service);
        return streamIterable(host, resolved, service, method, args, instance)[Symbol.asyncIterator]();
      });
    },

    listen(scope, source, handler, onError) {
      let inner: IDisposable | undefined;
      let disposed = false;
      void host.resolveScope(scope).then(
        (resolved) => {
          if (disposed) return;
          try {
            inner = subscribeSource(host, resolved, source, handler);
          } catch (error) {
            onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        },
        (error: unknown) => {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        },
      );
      return {
        dispose: () => {
          disposed = true;
          inner?.dispose();
        },
      };
    },
  };
}