import type { ChannelAttachment, InboundChannelMessage, OutboundChannelMessage } from '../contracts';
import { WebhookChannelAdapter, type WebhookAdapterOptions } from './base';

export interface TelegramAdapterOptions extends Omit<WebhookAdapterOptions, 'endpoint'> {
  readonly botToken: string;
  readonly apiBase?: string;
}

export class TelegramChannelAdapter extends WebhookChannelAdapter {
  readonly kind = 'telegram' as const;

  constructor(options: TelegramAdapterOptions) {
    const apiBase = options.apiBase ?? 'https://api.telegram.org';
    super({ ...options, endpoint: `${apiBase}/bot${options.botToken}/sendMessage` });
  }

  protected payload(message: OutboundChannelMessage): unknown {
    return {
      chat_id: message.conversationId,
      text: message.text,
      ...(message.replyToMessageId === undefined ? {} : { reply_to_message_id: message.replyToMessageId }),
      ...(message.markdown === true ? { parse_mode: 'HTML' } : {}),
    };
  }

  protected override messageIdFrom(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const result = (body as Record<string, unknown>)['result'];
    if (typeof result !== 'object' || result === null) return undefined;
    const messageId = (result as Record<string, unknown>)['message_id'];
    return typeof messageId === 'number' ? String(messageId) : undefined;
  }

  async handleUpdate(update: unknown): Promise<InboundChannelMessage | undefined> {
    if (typeof update !== 'object' || update === null) return undefined;
    const message = (update as Record<string, unknown>)['message'];
    if (typeof message !== 'object' || message === null) return undefined;
    const record = message as Record<string, unknown>;
    const messageId = record['message_id'];
    const date = record['date'];
    const text = record['text'] ?? record['caption'];
    const chat = record['chat'];
    const from = record['from'];
    if (typeof messageId !== 'number' || typeof chat !== 'object' || chat === null) return undefined;
    const chatRecord = chat as Record<string, unknown>;
    const conversationId = chatRecord['id'];
    if (typeof conversationId !== 'number' && typeof conversationId !== 'string') return undefined;
    const user = typeof from === 'object' && from !== null ? (from as Record<string, unknown>) : {};
    const userId = user['id'];
    const normalized: InboundChannelMessage = {
      id: String(messageId),
      channel: this.kind,
      conversationId: String(conversationId),
      user: {
        id: typeof userId === 'number' || typeof userId === 'string' ? String(userId) : 'unknown',
        ...(typeof user['username'] === 'string' ? { username: user['username'] } : {}),
        ...(typeof user['first_name'] === 'string' ? { displayName: String(user['first_name']) } : {}),
      },
      ...(typeof text === 'string' ? { text } : {}),
      attachments: telegramAttachments(record),
      timestamp: typeof date === 'number' ? date * 1000 : Date.now(),
      metadata: { chatType: chatRecord['type'] },
    };
    await this.dispatch(normalized);
    return normalized;
  }
}

function telegramAttachments(record: Record<string, unknown>): readonly ChannelAttachment[] {
  const attachments: ChannelAttachment[] = [];
  const photos = record['photo'];
  if (Array.isArray(photos) && photos.length > 0) {
    const largest = photos[photos.length - 1];
    if (typeof largest === 'object' && largest !== null) {
      const fileId = (largest as Record<string, unknown>)['file_id'];
      if (typeof fileId === 'string') attachments.push({ kind: 'image', name: fileId });
    }
  }
  const document = record['document'];
  if (typeof document === 'object' && document !== null) {
    const file = document as Record<string, unknown>;
    attachments.push({
      kind: 'file',
      ...(typeof file['file_name'] === 'string' ? { name: file['file_name'] } : {}),
      ...(typeof file['mime_type'] === 'string' ? { mimeType: file['mime_type'] } : {}),
      ...(typeof file['file_size'] === 'number' ? { size: file['file_size'] } : {}),
    });
  }
  return attachments;
}
