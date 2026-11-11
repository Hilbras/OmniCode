import type {
  ChannelAdapter,
  ChannelKind,
  ChannelMessageHandler,
  ChannelSendResult,
  ChannelStatus,
  InboundChannelMessage,
  OutboundChannelMessage,
  ChannelUnsubscribe,
} from '../contracts';

export abstract class ChannelAdapterBase implements ChannelAdapter {
  abstract readonly kind: ChannelKind;
  protected running = false;
  protected error: string | undefined;
  protected lastOutboundAt: number | undefined;
  protected lastInboundAt: number | undefined;
  private readonly handlers = new Set<ChannelMessageHandler>();

  async start(): Promise<void> {
    this.running = true;
    this.error = undefined;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  status(): ChannelStatus {
    return {
      kind: this.kind,
      running: this.running,
      ready: this.running && this.error === undefined,
      error: this.error,
      lastOutboundAt: this.lastOutboundAt,
      lastInboundAt: this.lastInboundAt,
    };
  }

  onMessage(handler: ChannelMessageHandler): ChannelUnsubscribe {
    this.handlers.add(handler);
    return { dispose: () => this.handlers.delete(handler) };
  }

  abstract send(message: OutboundChannelMessage): Promise<ChannelSendResult>;

  protected async dispatch(message: InboundChannelMessage): Promise<void> {
    this.lastInboundAt = message.timestamp;
    for (const handler of [...this.handlers]) await handler(message);
  }

  protected recordSend(success: boolean, error?: string): void {
    if (success) {
      this.lastOutboundAt = Date.now();
      this.error = undefined;
      return;
    }
    this.error = error;
  }
}

export interface ChannelHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ChannelHttpTransport {
  postJson(url: string, body: unknown, headers?: Readonly<Record<string, string>>): Promise<ChannelHttpResponse>;
}

export class FetchChannelTransport implements ChannelHttpTransport {
  async postJson(url: string, body: unknown, headers: Readonly<Record<string, string>> = {}): Promise<ChannelHttpResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      parsed = { text };
    }
    return { status: response.status, body: parsed };
  }
}

export interface WebhookAdapterOptions {
  readonly endpoint: string;
  readonly transport?: ChannelHttpTransport;
  readonly headers?: Readonly<Record<string, string>>;
  readonly token?: string;
}

export abstract class WebhookChannelAdapter extends ChannelAdapterBase {
  protected constructor(private readonly options: WebhookAdapterOptions) {
    super();
  }

  protected get transport(): ChannelHttpTransport {
    return this.options.transport ?? new FetchChannelTransport();
  }

  protected get endpoint(): string {
    return this.options.endpoint;
  }

  protected get headers(): Readonly<Record<string, string>> {
    return this.options.headers ?? {};
  }

  protected abstract payload(message: OutboundChannelMessage): unknown;

  protected messageIdFrom(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const value = (body as Record<string, unknown>)['message_id'] ?? (body as Record<string, unknown>)['id'];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  }

  protected sendFailed(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const record = body as Record<string, unknown>;
    if (record['ok'] === false) return String(record['description'] ?? 'send failed');
    if (typeof record['errcode'] === 'number' && record['errcode'] !== 0) return String(record['errmsg'] ?? 'send failed');
    if (typeof record['code'] === 'number' && record['code'] !== 0) return String(record['msg'] ?? 'send failed');
    return undefined;
  }

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    try {
      const response = await this.transport.postJson(this.endpoint, this.payload(message), this.headers);
      const failure = response.status >= 400 ? `http ${response.status}` : this.sendFailed(response.body);
      if (failure !== undefined) {
        this.recordSend(false, failure);
        return { ok: false, error: failure };
      }
      this.recordSend(true);
      return { ok: true, messageId: this.messageIdFrom(response.body) };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.recordSend(false, messageText);
      return { ok: false, error: messageText };
    }
  }
}
