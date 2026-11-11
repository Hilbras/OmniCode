export type ChannelKind = 'telegram' | 'dingtalk' | 'wechat' | 'feishu' | 'slack';

export type ChannelConversationKind = 'direct' | 'group' | 'channel';

export interface ChannelUser {
  readonly id: string;
  readonly displayName?: string;
  readonly username?: string;
}

export interface ChannelConversation {
  readonly id: string;
  readonly kind: ChannelConversationKind;
  readonly title?: string;
}

export type ChannelAttachmentKind = 'image' | 'file' | 'audio' | 'video';

export interface ChannelAttachment {
  readonly kind: ChannelAttachmentKind;
  readonly url?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly size?: number;
}

export interface InboundChannelMessage {
  readonly id: string;
  readonly channel: ChannelKind;
  readonly conversationId: string;
  readonly user: ChannelUser;
  readonly text?: string;
  readonly attachments?: readonly ChannelAttachment[];
  readonly timestamp: number;
  readonly replyToMessageId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OutboundChannelMessage {
  readonly conversationId: string;
  readonly text: string;
  readonly markdown?: boolean;
  readonly attachments?: readonly ChannelAttachment[];
  readonly replyToMessageId?: string;
}

export interface ChannelSendResult {
  readonly ok: boolean;
  readonly messageId?: string;
  readonly error?: string;
}

export interface ChannelStatus {
  readonly kind: ChannelKind;
  readonly running: boolean;
  readonly ready: boolean;
  readonly error?: string;
  readonly accountId?: string;
  readonly lastOutboundAt?: number;
  readonly lastInboundAt?: number;
}

export type ChannelMessageHandler = (message: InboundChannelMessage) => void | Promise<void>;

export interface ChannelUnsubscribe {
  readonly dispose: () => void;
}

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ChannelStatus;
  send(message: OutboundChannelMessage): Promise<ChannelSendResult>;
  onMessage(handler: ChannelMessageHandler): ChannelUnsubscribe;
}

export interface ChannelSessionBinding {
  readonly channel: ChannelKind;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly updatedAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ChannelConfig {
  readonly kind: ChannelKind;
  readonly enabled: boolean;
  readonly accountId?: string;
  readonly workspaceRoot?: string;
  readonly allowedConversations?: readonly string[];
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface ChannelMemoryScope {
  readonly tier: 'channel';
  readonly channelId: string;
}

export function channelMemoryScope(channel: ChannelKind, conversationId: string): ChannelMemoryScope {
  return { tier: 'channel', channelId: `${channel}:${conversationId}` };
}
