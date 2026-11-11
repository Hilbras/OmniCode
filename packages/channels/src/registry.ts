import type { ChannelAdapter, ChannelKind, ChannelSendResult, ChannelStatus, OutboundChannelMessage } from './contracts';

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelKind, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.kind)) throw new Error(`channel already registered: ${adapter.kind}`);
    this.adapters.set(adapter.kind, adapter);
  }

  get(kind: ChannelKind): ChannelAdapter | undefined {
    return this.adapters.get(kind);
  }

  list(): readonly ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  statuses(): readonly ChannelStatus[] {
    return this.list().map((adapter) => adapter.status());
  }

  async startAll(): Promise<void> {
    for (const adapter of this.list()) await adapter.start();
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.list()) await adapter.stop();
  }

  async send(kind: ChannelKind, message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const adapter = this.adapters.get(kind);
    if (adapter === undefined) return { ok: false, error: `channel is not registered: ${kind}` };
    return adapter.send(message);
  }
}
