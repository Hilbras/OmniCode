import type { ChannelKind, ChannelSessionBinding } from './contracts';
import type { ChannelBindingPersistence } from './bindingStore';

function bindingKey(channel: ChannelKind, conversationId: string): string {
  return `${channel}:${conversationId}`;
}

export class ChannelSessionBindingService {
  private readonly bindings = new Map<string, ChannelSessionBinding>();
  private saveQueue: Promise<void> = Promise.resolve();
  private persistence: ChannelBindingPersistence | undefined;

  constructor(options: { readonly persistence?: ChannelBindingPersistence } = {}) {
    this.persistence = options.persistence;
  }

  async load(): Promise<void> {
    if (this.persistence === undefined) return;
    this.bindings.clear();
    for (const binding of await this.persistence.load()) {
      this.bindings.set(bindingKey(binding.channel, binding.conversationId), binding);
    }
  }

  async flush(): Promise<void> {
    await this.saveQueue;
  }

  bind(binding: Omit<ChannelSessionBinding, 'updatedAt'> & { readonly updatedAt?: number }): ChannelSessionBinding {
    const stored: ChannelSessionBinding = {
      ...binding,
      updatedAt: binding.updatedAt ?? Date.now(),
    };
    this.bindings.set(bindingKey(stored.channel, stored.conversationId), stored);
    this.queueSave();
    return stored;
  }

  get(channel: ChannelKind, conversationId: string): ChannelSessionBinding | undefined {
    return this.bindings.get(bindingKey(channel, conversationId));
  }

  list(channel?: ChannelKind): readonly ChannelSessionBinding[] {
    const values = [...this.bindings.values()].filter((binding) => channel === undefined || binding.channel === channel);
    return values.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  unbind(channel: ChannelKind, conversationId: string): boolean {
    const removed = this.bindings.delete(bindingKey(channel, conversationId));
    if (removed) this.queueSave();
    return removed;
  }

  clear(): void {
    this.bindings.clear();
    this.queueSave();
  }

  private queueSave(): void {
    if (this.persistence === undefined) return;
    const snapshot = this.list();
    this.saveQueue = this.saveQueue.then(() => this.persistence?.save(snapshot)).catch(() => undefined);
  }
}

export class ChannelConfigStore {
  private readonly configs = new Map<ChannelKind, import('./contracts').ChannelConfig>();

  set(config: import('./contracts').ChannelConfig): void {
    this.configs.set(config.kind, config);
  }

  get(kind: ChannelKind): import('./contracts').ChannelConfig | undefined {
    return this.configs.get(kind);
  }

  list(): readonly import('./contracts').ChannelConfig[] {
    return [...this.configs.values()];
  }

  remove(kind: ChannelKind): boolean {
    return this.configs.delete(kind);
  }

  allows(kind: ChannelKind, conversationId: string): boolean {
    const config = this.configs.get(kind);
    if (config === undefined || !config.enabled) return false;
    const allowed = config.allowedConversations;
    return allowed === undefined || allowed.length === 0 || allowed.includes(conversationId);
  }
}
