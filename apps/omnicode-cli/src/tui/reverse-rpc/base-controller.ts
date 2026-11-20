/**
 * Base class for promise-based reverse RPC dialog controllers.
 *
 * Approval and question flows wait for a UI action before returning a response.
 * Subclasses only need to define the default cancellation response.
 *
 * When concurrent requests arrive (e.g. multiple parallel subagents each
 * needing approval), only one panel is shown at a time; additional requests
 * are queued in arrival order and advance after the current one resolves.
 */

export interface ReverseRpcUIHooks<TPayload> {
  showPanel(payload: TPayload): void;
  hidePanel(): void;
}

interface Pending<TPayload, TResponse> {
  readonly payload: TPayload;
  readonly resolve: (data: TResponse) => void;
}

export abstract class ReverseRpcController<TPayload, TResponse> {
  private uiHooks: ReverseRpcUIHooks<TPayload> | null = null;
  private current: Pending<TPayload, TResponse> | null = null;
  private queue: Array<Pending<TPayload, TResponse>> = [];

  setUIHooks(hooks: ReverseRpcUIHooks<TPayload>): void {
    this.uiHooks = hooks;
  }

  /**
   * Called when a reverse RPC request arrives from core. The returned promise
   * resolves after the user responds or `cancelAll` forces cancellation.
   */
  show(payload: TPayload): Promise<TResponse> {
    return new Promise<TResponse>((resolve) => {
      const entry: Pending<TPayload, TResponse> = { payload, resolve };
      if (this.current === null) {
        this.current = entry;
        this.uiHooks?.showPanel(payload);
      } else {
        this.queue.push(entry);
      }
    });
  }

  /** Called by the UI after the user makes a panel choice. */
  respond(data: TResponse): void {
    const pending = this.current;
    this.current = null;
    pending?.resolve(data);
    if (pending !== null) {
      this.drainAutoResolved(pending.payload, data);
    }
    this.advanceOrHide();
  }

  /** Cancels all pending requests during shutdown or session switches. */
  cancelAll(reason: string): void {
    const all = [...(this.current === null ? [] : [this.current]), ...this.queue];
    this.current = null;
    this.queue = [];
    this.uiHooks?.hidePanel();
    for (const entry of all) {
      entry.resolve(this.createCancelResponse(reason));
    }
  }

  hasPending(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /**
   * Resolves the pending request matched by `matches` when it was answered on
   * another surface (e.g. the Telegram connector). The pending promise gets
   * `cancelResponse`; the kernel-side `respond` for an already-resolved
   * interaction is a safe no-op. Returns the removed payload, or undefined
   * when nothing matched.
   */
  resolveExternally(
    matches: (payload: TPayload) => boolean,
    reason: string,
  ): TPayload | undefined {
    const cancelResponse = this.createCancelResponse(reason);
    const queuedIndex = this.queue.findIndex((entry) => matches(entry.payload));
    if (queuedIndex >= 0) {
      const entry = this.queue.splice(queuedIndex, 1)[0];
      if (entry === undefined) return undefined;
      entry.resolve(cancelResponse);
      return entry.payload;
    }
    if (this.current !== null && matches(this.current.payload)) {
      const entry = this.current;
      this.current = null;
      this.uiHooks?.hidePanel();
      entry.resolve(cancelResponse);
      this.advanceOrHide();
      return entry.payload;
    }
    return undefined;
  }

  private advanceOrHide(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.uiHooks?.hidePanel();
      return;
    }
    this.current = next;
    this.uiHooks?.showPanel(next.payload);
  }

  private drainAutoResolved(resolvedPayload: TPayload, response: TResponse): void {
    const remaining: Array<Pending<TPayload, TResponse>> = [];
    for (const entry of this.queue) {
      const auto = this.autoResolveFor(resolvedPayload, response, entry.payload);
      if (auto === undefined) {
        remaining.push(entry);
      } else {
        entry.resolve(auto);
      }
    }
    this.queue = remaining;
  }

  /**
   * Subclasses override to short-circuit queued requests when an answer to the
   * just-resolved one (e.g. an approve-for-session) implies the same answer
   * for matching queued requests. Return `undefined` to leave the queued
   * request waiting for its own panel turn.
   */
  protected autoResolveFor(
    _resolvedPayload: TPayload,
    _response: TResponse,
    _queuedPayload: TPayload,
  ): TResponse | undefined {
    return undefined;
  }

  protected abstract createCancelResponse(reason: string): TResponse;
}
