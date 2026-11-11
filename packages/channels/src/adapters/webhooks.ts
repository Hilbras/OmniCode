import type { ChannelKind, InboundChannelMessage, OutboundChannelMessage } from '../contracts';
import { WebhookChannelAdapter, type WebhookAdapterOptions } from './base';

export class DingTalkChannelAdapter extends WebhookChannelAdapter {
  readonly kind = 'dingtalk' as const;

  constructor(options: WebhookAdapterOptions) {
    super(options);
  }

  protected payload(message: OutboundChannelMessage): unknown {
    return { msgtype: 'text', text: { content: message.text } };
  }

  async handleWebhook(payload: unknown): Promise<InboundChannelMessage | undefined> {
    return webhookMessage(this.kind, payload);
  }
}

export class WeChatChannelAdapter extends WebhookChannelAdapter {
  readonly kind = 'wechat' as const;

  constructor(options: WebhookAdapterOptions) {
    super(options);
  }

  protected payload(message: OutboundChannelMessage): unknown {
    return { msgtype: 'text', text: { content: message.text } };
  }

  async handleWebhook(payload: unknown): Promise<InboundChannelMessage | undefined> {
    return webhookMessage(this.kind, payload);
  }
}

export class FeishuChannelAdapter extends WebhookChannelAdapter {
  readonly kind = 'feishu' as const;

  constructor(options: WebhookAdapterOptions) {
    super(options);
  }

  protected payload(message: OutboundChannelMessage): unknown {
    return { msg_type: 'text', content: { text: message.text } };
  }

  async handleWebhook(payload: unknown): Promise<InboundChannelMessage | undefined> {
    return webhookMessage(this.kind, payload);
  }
}

export class SlackChannelAdapter extends WebhookChannelAdapter {
  readonly kind = 'slack' as const;

  constructor(options: WebhookAdapterOptions) {
    super(options);
  }

  protected payload(message: OutboundChannelMessage): unknown {
    return { text: message.text, ...(message.attachments === undefined ? {} : { attachments: message.attachments }) };
  }

  async handleWebhook(payload: unknown): Promise<InboundChannelMessage | undefined> {
    return webhookMessage(this.kind, payload);
  }
}

function webhookMessage(kind: ChannelKind, payload: unknown): InboundChannelMessage | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const event = typeof record['event'] === 'object' && record['event'] !== null
    ? (record['event'] as Record<string, unknown>)
    : record;
  const conversationId = firstString(event['conversation_id'], event['chat_id'], event['room_id'], record['conversationId'], record['channel']);
  const userId = firstString(event['user_id'], event['sender_id'], event['from'], record['userId']);
  const text = firstString(event['text'], event['content'], record['text']);
  if (conversationId === undefined) return undefined;
  return {
    id: firstString(event['message_id'], event['id'], record['id']) ?? `${kind}-${Date.now()}`,
    channel: kind,
    conversationId,
    user: { id: userId ?? 'unknown' },
    ...(text === undefined ? {} : { text }),
    timestamp: typeof event['timestamp'] === 'number' ? event['timestamp'] : Date.now(),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}
