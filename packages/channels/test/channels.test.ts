import { describe, expect, it } from 'vitest';

import {
  ChannelConfigStore,
  ChannelRegistry,
  ChannelSessionBindingService,
  DingTalkChannelAdapter,
  FeishuChannelAdapter,
  SlackChannelAdapter,
  TelegramChannelAdapter,
  WeChatChannelAdapter,
  channelMemoryScope,
  executeChannelCommand,
  parseChannelCommand,
  ChannelRuntimeService,
  type ChannelHttpResponse,
  type ChannelHttpTransport,
} from '#/index';

class RecordingTransport implements ChannelHttpTransport {
  readonly calls: { readonly url: string; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> }[] = [];
  response: ChannelHttpResponse = { status: 200, body: { ok: true, result: { message_id: 7 } } };

  async postJson(url: string, body: unknown, headers?: Readonly<Record<string, string>>): Promise<ChannelHttpResponse> {
    this.calls.push({ url, body, headers });
    return this.response;
  }
}

describe('channel platform', () => {
  it('binds conversations to sessions and enforces channel config allowlists', () => {
    const bindings = new ChannelSessionBindingService();
    const configs = new ChannelConfigStore();
    configs.set({ kind: 'telegram', enabled: true, allowedConversations: ['c1'] });
    expect(configs.allows('telegram', 'c1')).toBe(true);
    expect(configs.allows('telegram', 'c2')).toBe(false);
    const bound = bindings.bind({ channel: 'telegram', conversationId: 'c1', sessionId: 's1', workspaceRoot: '/w' });
    expect(bindings.get('telegram', 'c1')).toMatchObject({ sessionId: 's1', workspaceRoot: '/w' });
    expect(bindings.list('telegram')).toHaveLength(1);
    expect(bound.updatedAt).toBeGreaterThan(0);
    expect(bindings.unbind('telegram', 'c1')).toBe(true);
  });

  it('parses and executes lifecycle commands', async () => {
    const bindings = new ChannelSessionBindingService();
    expect(parseChannelCommand('hello')).toBeUndefined();
    expect(parseChannelCommand('/new@bot /tmp')).toMatchObject({ name: 'new', args: ['/tmp'] });

    const created = await executeChannelCommand('/new /tmp', {
      channel: 'telegram',
      conversationId: 'c1',
      bindings,
      createSession: async () => ({ sessionId: 's1', workspaceRoot: '/tmp' }),
    });
    expect(created).toMatchObject({ handled: true, ok: true });
    expect(bindings.get('telegram', 'c1')?.sessionId).toBe('s1');

    const status = await executeChannelCommand('/status', { channel: 'telegram', conversationId: 'c1', bindings });
    expect(status.text).toContain('s1');

    const stopped = await executeChannelCommand('/stop', {
      channel: 'telegram',
      conversationId: 'c1',
      bindings,
      stopSession: async () => true,
    });
    expect(stopped.ok).toBe(true);
    expect(bindings.get('telegram', 'c1')).toBeUndefined();
  });

  it('registers adapters and starts/stops them', async () => {
    const registry = new ChannelRegistry();
    const adapter = new SlackChannelAdapter({ endpoint: 'https://example.invalid/hook', transport: new RecordingTransport() });
    registry.register(adapter);
    expect(registry.get('slack')).toBe(adapter);
    await registry.startAll();
    expect(adapter.status().running).toBe(true);
    await registry.stopAll();
    expect(adapter.status().running).toBe(false);
    expect(registry.get('telegram')).toBeUndefined();
  });

  it('sends telegram payloads without leaking the token in the result', async () => {
    const transport = new RecordingTransport();
    const adapter = new TelegramChannelAdapter({ botToken: 'secret-token', transport });
    const result = await adapter.send({ conversationId: '123', text: 'hello', markdown: true });
    expect(result).toEqual({ ok: true, messageId: '7' });
    expect(transport.calls[0]?.url).toContain('/botsecret-token/sendMessage');
    expect(transport.calls[0]?.body).toMatchObject({ chat_id: '123', text: 'hello', parse_mode: 'HTML' });
  });

  it('normalizes telegram updates into inbound messages with attachments', async () => {
    const adapter = new TelegramChannelAdapter({ botToken: 't', transport: new RecordingTransport() });
    const received: string[] = [];
    adapter.onMessage((message) => { received.push(message.id); });
    const message = await adapter.handleUpdate({
      message: {
        message_id: 9,
        date: 100,
        text: 'hi',
        chat: { id: 5, type: 'private' },
        from: { id: 3, first_name: 'Ada', username: 'ada' },
        document: { file_name: 'a.txt', mime_type: 'text/plain', file_size: 2 },
      },
    });
    expect(message).toMatchObject({ id: '9', conversationId: '5', user: { id: '3', displayName: 'Ada' }, timestamp: 100_000 });
    expect(message?.attachments?.[0]).toMatchObject({ kind: 'file', name: 'a.txt' });
    expect(received).toEqual(['9']);
  });

  it('sends the provider-specific payloads', async () => {
    const transport = new RecordingTransport();
    const adapters = [
      new DingTalkChannelAdapter({ endpoint: 'https://example.invalid/ding', transport }),
      new WeChatChannelAdapter({ endpoint: 'https://example.invalid/wechat', transport }),
      new FeishuChannelAdapter({ endpoint: 'https://example.invalid/feishu', transport }),
      new SlackChannelAdapter({ endpoint: 'https://example.invalid/slack', transport }),
    ];
    for (const adapter of adapters) expect((await adapter.send({ conversationId: 'c', text: 'x' })).ok).toBe(true);
    expect(transport.calls.map((call) => call.body)).toEqual([
      { msgtype: 'text', text: { content: 'x' } },
      { msgtype: 'text', text: { content: 'x' } },
      { msg_type: 'text', content: { text: 'x' } },
      { text: 'x' },
    ]);
  });

  it('returns explicit send failures', async () => {
    const transport = new RecordingTransport();
    transport.response = { status: 500, body: { ok: false, description: 'bad gateway' } };
    const adapter = new TelegramChannelAdapter({ botToken: 't', transport });
    const result = await adapter.send({ conversationId: 'c', text: 'x' });
    expect(result).toEqual({ ok: false, error: 'http 500' });
    expect(adapter.status().ready).toBe(false);
  });

  it('starts enabled adapters and dispatches commands and bound messages', async () => {
    const transport = new RecordingTransport();
    const received: string[] = [];
    const runtime = new ChannelRuntimeService({
      configs: [
        {
          kind: 'telegram',
          enabled: true,
          adapter: 'telegram',
          botTokenEnv: 'TELEGRAM_BOT_TOKEN',
          allowedConversations: ['42'],
        },
      ],
      env: { TELEGRAM_BOT_TOKEN: 'token' },
      transport,
      createSession: async () => ({ sessionId: 'session-1', workspaceRoot: '/workspace' }),
      onMessage: async (message, binding) => {
        received.push(`${binding.sessionId}:${message.text ?? ''}`);
      },
    });

    const status = await runtime.start();
    expect(status).toMatchObject({ started: true, adapters: ['telegram'], errors: [] });

    await runtime.handleInbound({
      id: '1',
      channel: 'telegram',
      conversationId: '42',
      user: { id: 'u' },
      text: '/new',
      timestamp: 1,
    });
    await runtime.handleInbound({
      id: '2',
      channel: 'telegram',
      conversationId: '42',
      user: { id: 'u' },
      text: 'ship it',
      timestamp: 2,
    });

    expect(runtime.listBindings('telegram')[0]?.sessionId).toBe('session-1');
    expect(received).toEqual(['session-1:ship it']);
    expect(transport.calls.length).toBeGreaterThanOrEqual(1);
    await runtime.stop();
  });

  it('does not start disabled channels', async () => {
    const runtime = new ChannelRuntimeService({
      configs: [{ kind: 'slack', enabled: false, adapter: 'slack', webhookUrlEnv: 'SLACK_WEBHOOK_URL' }],
      env: { SLACK_WEBHOOK_URL: 'https://example.invalid/hook' },
      transport: new RecordingTransport(),
    });
    const status = await runtime.start();
    expect(status.adapters).toEqual([]);
    await runtime.stop();
  });

  it('produces a channel-scoped memory key', () => {
    expect(channelMemoryScope('telegram', '42')).toEqual({ tier: 'channel', channelId: 'telegram:42' });
  });
});
