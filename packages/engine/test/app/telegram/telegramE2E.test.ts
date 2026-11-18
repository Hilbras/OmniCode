import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IEventBus } from '#/app/event/eventBus';
import type { IBootstrapService } from '#/app/bootstrap/bootstrap';
import type { ISessionManager } from '#/app/sessionManager/sessionManager';
import type { IWorkspaceService } from '#/app/workspace/workspace';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IModelCatalog } from '#/llm-adapter/model/catalog';
import { ISessionMediaStore } from '#/agent/media/sessionMediaStore';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { TelegramConnectorService } from '#/app/telegram/telegramService';
import { interactions } from '#/human/interaction/facade';
import {
  INTERACTION_TAG_AGENT_ID,
  INTERACTION_TAG_SESSION_ID,
} from '#/human/interaction/interaction';

const TOKEN = '123456:ABC-DEF';
const CHAT_ID = 123;

interface RecordedMessage {
  readonly chatId: number;
  readonly text: string;
}

type FakeUpdate = Record<string, unknown>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}

class FakeTelegramApi {
  readonly sent: RecordedMessage[] = [];
  readonly edited: RecordedMessage[] = [];
  readonly bodies: Record<string, unknown>[] = [];
  readonly editedBodies: Record<string, unknown>[] = [];
  readonly chatActions: string[] = [];
  readonly reactions: string[] = [];
  readonly deletedMessages: number[] = [];
  readonly answers: string[] = [];
  failSendMessageTimes = 0;
  sendMessageAttempts = 0;
  readonly offsets: number[] = [];
  private readonly queue: FakeUpdate[][] = [];
  private messageId = 1;
  private calls = 0;

  push(updates: FakeUpdate[]): void {
    this.queue.push(updates);
  }

  readonly fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.href;
    const method = url.split('/').pop() ?? '';
    const body = requestBody(init);
    if (method === 'getMe') {
      return jsonResponse({
        ok: true,
        result: { id: 1, username: 'omnicode_bot', first_name: 'OmniCode' },
      });
    }
    if (method === 'getFile') {
      return jsonResponse({ ok: true, result: { file_path: 'photos/file_1.jpg' } });
    }
    if (method === 'setWebhook' || method === 'deleteWebhook') {
      return jsonResponse({ ok: true, result: true });
    }
    if (method === 'sendChatAction') {
      this.chatActions.push(String(body['action'] ?? ''));
      return jsonResponse({ ok: true, result: true });
    }
    if (method === 'deleteMessage') {
      this.deletedMessages.push(Number(body['message_id']));
      return jsonResponse({ ok: true, result: true });
    }
    if (method === 'setMessageReaction') {
      const reaction = Array.isArray(body['reaction']) ? body['reaction'][0] : undefined;
      this.reactions.push(String((reaction as { emoji?: string } | undefined)?.emoji ?? ''));
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes('/file/bot')) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' },
      });
    }
    if (method === 'setMyCommands' || method === 'setChatMenuButton') {
      return jsonResponse({ ok: true, result: true });
    }
    if (method === 'getUpdates') {
      this.calls += 1;
      this.offsets.push(Number(body['offset'] ?? 0));
      const next = this.queue.shift();
      if (next !== undefined) return jsonResponse({ ok: true, result: next });
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({ ok: true, result: [] });
    }
    if (method === 'sendMessage') {
      this.sendMessageAttempts += 1;
      if (this.failSendMessageTimes > 0) {
        this.failSendMessageTimes -= 1;
        return jsonResponse({ ok: false, description: 'temporary failure' }, 500);
      }
      this.bodies.push(body);
      this.sent.push({ chatId: Number(body['chat_id']), text: String(body['text'] ?? '') });
      const id = this.messageId;
      this.messageId += 1;
      return jsonResponse({ ok: true, result: { message_id: id } });
    }
    if (method === 'editMessageText') {
      this.editedBodies.push(body);
      this.edited.push({ chatId: Number(body['chat_id']), text: String(body['text'] ?? '') });
      return jsonResponse({ ok: true, result: true });
    }
    if (method === 'editMessageReplyMarkup') {
      return jsonResponse({ ok: true, result: true });
    }
    if (method === 'answerCallbackQuery') {
      this.answers.push(String(body['text'] ?? ''));
      return jsonResponse({ ok: true, result: true });
    }
    return jsonResponse({ ok: false, description: `unexpected method ${method}` });
  });

  get updateCalls(): number {
    return this.calls;
  }
}

describe('Telegram connector end-to-end', () => {
  let homeDir: string;
  let service: TelegramConnectorService;
  let api: FakeTelegramApi;
  let pairingCode = '';
  let lastSubmit: unknown;
  let interactionRequest:
    | { readonly id: string; readonly kind: string; readonly payload: unknown }
    | undefined;
  let memorySaved:
    | { readonly content: string; readonly category: string; readonly trust: string }
    | undefined;
  const mediaInputs: { fileId: string; name: string; mimeType: string }[] = [];
  let memoryHistory: { role: string; content: { type: string; text: string }[] }[] = [];
  const listeners: ((event: unknown) => void)[] = [];

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'omnicode-telegram-e2e-'));
    pairingCode = '';
    lastSubmit = undefined;
    interactionRequest = undefined;
    memorySaved = undefined;
    mediaInputs.length = 0;
    memoryHistory = [];
    listeners.length = 0;
    api = new FakeTelegramApi();
    vi.stubGlobal('fetch', api.fetch);

    const session = {
      accessor: {
        get: (token: unknown) => {
          if (token === IAgentLifecycleService) {
            return {
              create: vi.fn(async () => ({ agentId: 'main' })),
              handleOf: vi.fn(() => ({
                id: 'main',
                accessor: {
                  get: (inner: unknown) => {
                    if (inner === IAgentLoopService) {
                      return {
                        submit: (input: unknown) => {
                          lastSubmit = input;
                          const request = interactionRequest;
                          const saved = memorySaved;
                          setTimeout(() => {
                            for (const listener of listeners) {
                              listener({
                                type: 'assistant.delta',
                                agentId: 'main',
                                delta: 'Hello from OmniCode',
                              });
                              if (request !== undefined) {
                                listener({
                                  type: 'interaction.request',
                                  agentId: 'main',
                                  id: request.id,
                                  kind: request.kind,
                                  request: request.payload,
                                });
                              }
                              if (saved !== undefined) {
                                listener({
                                  type: 'memory.saved',
                                  agentId: 'main',
                                  memoryId: 'mem-test',
                                  ...saved,
                                  scope: 'repository',
                                });
                              }
                            }
                          }, 10);
                          return { id: 'prompt-1' };
                        },
                        promptHandle: () => ({
                          completion: new Promise((resolve) =>
                            setTimeout(() => resolve({ state: 'completed' }), 60),
                          ),
                        }),
                        cancel: vi.fn(),
                      };
                    }
                    if (inner === IEventBus) {
                      return {
                        subscribe: (listener: (event: unknown) => void) => {
                          listeners.push(listener);
                          return {
                            dispose: () => {
                              const index = listeners.indexOf(listener);
                              if (index >= 0) listeners.splice(index, 1);
                            },
                          };
                        },
                      };
                    }
                    if (inner === IAgentPermissionModeService) {
                      return { setMode: vi.fn() };
                    }
                    if (inner === IModelCatalog) {
                      return {
                        listModels: vi.fn(async () => [
                          { provider: 'test', model: 'model-1' },
                          { provider: 'test', model: 'model-2' },
                        ]),
                      };
                    }
                    if (inner === IAgentProfileService) {
                      return {
                        getModel: vi.fn(() => 'model-1'),
                        setModel: vi.fn(async (model: string) => ({ model })),
                      };
                    }
                    if (inner === IAgentContextMemoryService) {
                      return { get: vi.fn(() => memoryHistory) };
                    }
                    return undefined;
                  },
                },
              })),
            };
          }
          if (token === ISessionContext) {
            return {
              sessionId: 'session-1',
              cwd: homeDir,
              sessionDir: join(homeDir, 'sessions', 'session-1'),
            };
          }
          if (token === ISessionMetadata) {
            return {
              read: vi.fn(async () => ({
                id: 'session-1',
                createdAt: 1,
                updatedAt: 2,
                archived: false,
              })),
            };
          }
          if (token === ISessionMediaStore) {
            return {
              materialize: vi.fn(
                async (input: { fileId: string; name: string; mimeType: string }) => {
                  mediaInputs.push(input);
                  return `/tmp/${input.fileId}`;
                },
              ),
            };
          }
          return undefined;
        },
      },
    };

    service = new TelegramConnectorService(
      { homeDir } as unknown as IBootstrapService,
      { createOrTouch: vi.fn(async () => ({ id: 'workspace-1' })) } as unknown as IWorkspaceService,
      {
        create: vi.fn(async () => session),
        get: vi.fn(() => session),
        resume: vi.fn(async () => session),
        list: vi.fn(() => [session]),
      } as unknown as ISessionManager,
    );
  });

  afterEach(async () => {
    await service.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    vi.unstubAllGlobals();
    await rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function pair(): Promise<void> {
    await service.saveSettings({ botToken: TOKEN });
    pairingCode = (await service.createPairingCode()).code;
  }

  it('pairs, binds a session, routes a message and delivers the assistant reply', async () => {
    await pair();
    api.push([
      { update_id: 1, message: { chat: { id: CHAT_ID }, text: `/start ${pairingCode}` } },
    ]);
    api.push([
      { update_id: 2, message: { message_id: 10, chat: { id: CHAT_ID }, text: 'hello' } },
    ]);
    await service.start();

    await waitFor(
      () =>
        api.edited.some((entry) => entry.text === 'Hello from OmniCode') ||
        api.sent.some((entry) => entry.text === 'Hello from OmniCode'),
    );

    const progress = api.bodies.find((body) => body['text'] === 'OmniCode is working…');
    expect(progress?.['reply_parameters']).toEqual({
      message_id: 10,
      allow_sending_without_reply: true,
    });
    expect(api.chatActions).toContain('typing');
    expect(api.reactions).toContain('👀');
    expect(api.reactions).toContain('👍');

    const config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      allowedChatIds?: number[];
      bindings?: Record<string, { sessionId?: string }>;
    };
    expect(config.allowedChatIds).toContain(CHAT_ID);
    expect(config.bindings?.[String(CHAT_ID)]?.sessionId).toBe('session-1');

    const reply = [...api.sent, ...api.edited].find(
      (entry) => entry.text === 'Hello from OmniCode',
    );
    expect(reply?.chatId).toBe(CHAT_ID);

    const state = JSON.parse(await readFile(join(homeDir, 'telegram-state.json'), 'utf8')) as {
      lastUpdateId?: number;
    };
    expect(state.lastUpdateId).toBe(2);
  });

  it('ignores duplicate update ids', async () => {
    await pair();
    const start = {
      update_id: 1,
      message: { chat: { id: CHAT_ID }, text: `/start ${pairingCode}` },
    };
    api.push([start]);
    api.push([start]);
    await service.start();

    await waitFor(() => api.sent.some((entry) => entry.text.startsWith('Paired with OmniCode')));
    await waitFor(() => api.updateCalls >= 3);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const paired = api.sent.filter((entry) => entry.text.startsWith('Paired with OmniCode'));
    expect(paired).toHaveLength(1);
    expect(api.sent.some((entry) => entry.text.includes('Pair this chat from OmniCode'))).toBe(
      false,
    );
  });

  it('rejects messages from chats that are not paired', async () => {
    await pair();
    api.push([{ update_id: 1, message: { chat: { id: 999 }, text: 'hello' } }]);
    await service.start();

    await waitFor(() =>
      api.sent.some((entry) => entry.text.includes('This chat is not paired')),
    );

    const config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      bindings?: Record<string, unknown>;
    };
    expect(config.bindings?.['999']).toBeUndefined();
  });

  it('blocks pairing after five failed attempts', async () => {
    await pair();
    for (let index = 1; index <= 5; index += 1) {
      api.push([
        {
          update_id: index,
          message: { chat: { id: 777 }, text: '/start WRONG' },
        },
      ]);
    }
    api.push([
      {
        update_id: 6,
        message: { chat: { id: 777 }, text: `/start ${pairingCode}` },
      },
    ]);
    await service.start();

    await waitFor(
      () =>
        api.sent.filter((entry) => entry.text.includes('Pair this chat from OmniCode')).length >= 6,
    );

    const config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      allowedChatIds?: number[];
    };
    expect(config.allowedChatIds ?? []).not.toContain(777);
  });

  it('accepts a Telegram photo and forwards it as image content', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          caption: 'what is this?',
          photo: [
            { file_id: 'small', file_size: 3 },
            { file_id: 'large', file_size: 3 },
          ],
        },
      },
    ]);
    await service.start();

    await waitFor(() => lastSubmit !== undefined);

    const content = (lastSubmit as { message: { content: unknown[] } }).message.content;
    const image = content.find(
      (part): part is { type: 'image_url'; imageUrl: { url: string; id: string; name: string } } =>
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'image_url',
    );
    expect(image?.imageUrl.url).toMatch(/^omnicode-file:\/\/f_tg_/);
    expect(image?.imageUrl.id).toMatch(/^f_tg_/);
    expect(image?.imageUrl.name).toBe('telegram-photo.jpg');
    expect(content).toContainEqual({ type: 'text', text: 'what is this?' });
    expect(mediaInputs[0]).toMatchObject({
      name: 'telegram-photo.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('accepts an image sent as a document', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          caption: 'document image',
          document: {
            file_id: 'doc-1',
            file_name: 'shot.png',
            mime_type: 'image/png',
            file_size: 3,
          },
        },
      },
    ]);
    await service.start();

    await waitFor(() => lastSubmit !== undefined);

    const content = (lastSubmit as { message: { content: unknown[] } }).message.content;
    const image = content.find(
      (part): part is { type: 'image_url'; imageUrl: { url: string; id: string; name: string } } =>
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'image_url',
    );
    expect(image?.imageUrl.name).toBe('shot.png');
    expect(image?.imageUrl.id).toMatch(/^f_tg_/);
    expect(mediaInputs[0]).toMatchObject({ name: 'shot.png', mimeType: 'image/png' });
  });

  it('accepts a video message', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          video: { file_id: 'v1', file_size: 3, mime_type: 'video/mp4' },
        },
      },
    ]);
    await service.start();

    await waitFor(() => lastSubmit !== undefined);

    const content = (lastSubmit as { message: { content: unknown[] } }).message.content;
    expect(content).toContainEqual(expect.objectContaining({ type: 'video_url' }));
    expect(mediaInputs[0]).toMatchObject({ mimeType: 'video/mp4' });
  });

  it('accepts audio and voice messages', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          audio: { file_id: 'a1', file_size: 3, mime_type: 'audio/mpeg' },
        },
      },
    ]);
    api.push([
      {
        update_id: 2,
        message: {
          chat: { id: CHAT_ID },
          voice: { file_id: 'vo1', file_size: 3, mime_type: 'audio/ogg' },
        },
      },
    ]);
    await service.start();

    await waitFor(
      () =>
        mediaInputs.some((input) => input.mimeType === 'audio/mpeg') &&
        mediaInputs.some((input) => input.mimeType === 'audio/ogg'),
    );

    const content = (lastSubmit as { message: { content: unknown[] } }).message.content;
    expect(content).toContainEqual(expect.objectContaining({ type: 'audio_url' }));
  });

  it('accepts animation and static sticker media', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          animation: { file_id: 'an1', file_size: 3, mime_type: 'video/mp4' },
        },
      },
    ]);
    api.push([
      {
        update_id: 2,
        message: {
          chat: { id: CHAT_ID },
          sticker: { file_id: 'st1', file_size: 3, mime_type: 'image/webp' },
        },
      },
    ]);
    await service.start();

    await waitFor(
      () =>
        mediaInputs.some((input) => input.mimeType === 'video/mp4') &&
        mediaInputs.some((input) => input.mimeType === 'image/webp'),
    );

    expect(mediaInputs.map((input) => input.mimeType)).toEqual(
      expect.arrayContaining(['video/mp4', 'image/webp']),
    );
  });

  it('binds and detaches the current session', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: '/bind' } }]);
    await service.start();

    await waitFor(() => api.sent.some((entry) => entry.text.startsWith('Session:')));
    let config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      bindings?: Record<string, { sessionId?: string }>;
    };
    expect(config.bindings?.[String(CHAT_ID)]?.sessionId).toBe('session-1');

    await service.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    api.push([{ update_id: 2, message: { chat: { id: CHAT_ID }, text: '/detach' } }]);
    await service.start();

    await waitFor(() => api.sent.some((entry) => entry.text.startsWith('Detached from')));
    config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      bindings?: Record<string, { sessionId?: string }>;
    };
    expect(config.bindings?.[String(CHAT_ID)]).toBeUndefined();
  });

  it('renders an inline session picker', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: '/sessions' } }]);
    await service.start();

    await waitFor(() => api.bodies.some((body) => body['reply_markup'] !== undefined));

    const body = api.bodies.find((entry) => entry['reply_markup'] !== undefined);
    const keyboard = (body?.['reply_markup'] as { inline_keyboard?: { callback_data?: string }[][] })
      ?.inline_keyboard;
    expect(keyboard?.[0]?.[0]?.callback_data).toBe('s:session-1');
  });

  it('answers a multi-question flow', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    const answered = interactions.request({
      id: 'q1',
      kind: 'question',
      payload: {
        questions: [
          { question: 'First?', options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Second?', options: [{ label: 'C' }] },
        ],
      },
    });
    interactionRequest = {
      id: 'q1',
      kind: 'question',
      payload: {
        questions: [
          { question: 'First?', options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Second?', options: [{ label: 'C' }] },
        ],
      },
    };
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: 'hello' } }]);
    await service.start();

    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('q:q1:0:0')));

    api.push([
      {
        update_id: 2,
        callback_query: {
          id: 'cb1',
          data: 'q:q1:0:1',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);
    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('q:q1:1:0')));

    api.push([
      {
        update_id: 3,
        callback_query: {
          id: 'cb2',
          data: 'q:q1:1:0',
          message: { message_id: 2, chat: { id: CHAT_ID } },
        },
      },
    ]);

    await expect(answered).resolves.toEqual({ answers: { 'First?': 'B', 'Second?': 'C' } });
    expect(
      api.editedBodies.some(
        (body) =>
          JSON.stringify(body['reply_markup']) === JSON.stringify({ inline_keyboard: [] }),
      ),
    ).toBe(true);
  });

  it('collects a multi-select answer', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    const payload = {
      questions: [
        {
          question: 'Pick many',
          multiSelect: true,
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    };
    const answered = interactions.request({ id: 'q2', kind: 'question', payload });
    interactionRequest = { id: 'q2', kind: 'question', payload };
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: 'hello' } }]);
    await service.start();

    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('qm:q2:0:0')));

    api.push([
      {
        update_id: 2,
        callback_query: {
          id: 'cb1',
          data: 'qm:q2:0:0',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);
    api.push([
      {
        update_id: 3,
        callback_query: {
          id: 'cb2',
          data: 'qm:q2:0:1',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);
    api.push([
      {
        update_id: 4,
        callback_query: {
          id: 'cb3',
          data: 'qm:q2:0:done',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);

    await expect(answered).resolves.toEqual({ answers: { 'Pick many': 'A, B' } });
  });

  it('approves a plan with the selected approach', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    const approved = interactions.request({
      id: 'p1',
      kind: 'approval',
      payload: {
        action: 'ExitPlanMode',
        display: {
          kind: 'plan_review',
          plan: 'Do the thing',
          options: [
            { label: 'Approach A', description: 'first' },
            { label: 'Approach B', description: 'second' },
          ],
        },
      },
    });
    interactionRequest = {
      id: 'p1',
      kind: 'approval',
      payload: {
        action: 'ExitPlanMode',
        display: {
          kind: 'plan_review',
          plan: 'Do the thing',
          options: [
            { label: 'Approach A', description: 'first' },
            { label: 'Approach B', description: 'second' },
          ],
        },
      },
    };
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: 'hello' } }]);
    await service.start();

    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('p:p1:o:1')));

    api.push([
      {
        update_id: 2,
        callback_query: {
          id: 'cb1',
          data: 'p:p1:o:1',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);

    await expect(approved).resolves.toEqual({
      decision: 'approved',
      selectedLabel: 'Approach B',
    });
    expect(
      api.editedBodies.some(
        (body) =>
          JSON.stringify(body['reply_markup']) === JSON.stringify({ inline_keyboard: [] }),
      ),
    ).toBe(true);
  });

  it('sends plan revision feedback as the next message', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    const revised = interactions.request({
      id: 'p2',
      kind: 'approval',
      payload: {
        action: 'ExitPlanMode',
        display: { kind: 'plan_review', plan: 'Do the thing', options: [] },
      },
    });
    interactionRequest = {
      id: 'p2',
      kind: 'approval',
      payload: {
        action: 'ExitPlanMode',
        display: { kind: 'plan_review', plan: 'Do the thing', options: [] },
      },
    };
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: 'hello' } }]);
    await service.start();

    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('p:p2:r')));
    api.push([
      {
        update_id: 2,
        callback_query: {
          id: 'cb1',
          data: 'p:p2:r',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);
    await waitFor(() => api.bodies.some((body) => body['reply_markup'] !== undefined));
    api.push([
      {
        update_id: 3,
        message: { chat: { id: CHAT_ID }, text: 'use the simpler approach' },
      },
    ]);

    await expect(revised).resolves.toEqual({
      decision: 'rejected',
      feedback: 'use the simpler approach',
    });
  });

  it('offers model and permission inline keyboards', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: '/bind' } }]);
    api.push([{ update_id: 2, message: { chat: { id: CHAT_ID }, text: '/model' } }]);
    api.push([{ update_id: 3, message: { chat: { id: CHAT_ID }, text: '/permission' } }]);
    await service.start();

    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('m:model-2')));
    await waitFor(() => api.bodies.some((body) => JSON.stringify(body).includes('pm:auto')));

    api.push([
      {
        update_id: 4,
        callback_query: {
          id: 'cb-model',
          data: 'm:model-2',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);
    api.push([
      {
        update_id: 5,
        callback_query: {
          id: 'cb-perm',
          data: 'pm:auto',
          message: { message_id: 2, chat: { id: CHAT_ID } },
        },
      },
    ]);

    await waitFor(() => api.edited.some((entry) => entry.text === 'Model set to model-2.'));
    await waitFor(() =>
      api.edited.some((entry) => entry.text === 'Permission mode set to auto.'),
    );

    const config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      bindings?: Record<string, { permission?: string }>;
    };
    expect(config.bindings?.[String(CHAT_ID)]?.permission).toBe('auto');
  });

  it('refuses to start when another live process holds the lock', async () => {
    await pair();
    await writeFile(
      join(homeDir, 'telegram.lock'),
      JSON.stringify({ pid: process.ppid, host: hostname(), startedAt: Date.now() }),
      { mode: 0o600 },
    );

    await expect(service.start()).rejects.toThrow(/already running/);
  });

  it('takes over a stale lock', async () => {
    await pair();
    await writeFile(
      join(homeDir, 'telegram.lock'),
      JSON.stringify({ pid: 999_999, host: hostname(), startedAt: Date.now() }),
      { mode: 0o600 },
    );

    await expect(service.start()).resolves.toMatchObject({ running: true });
  });

  it('retries a transient send failure', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.failSendMessageTimes = 1;
    api.push([
      { update_id: 1, message: { message_id: 10, chat: { id: CHAT_ID }, text: 'hello' } },
    ]);
    await service.start();

    await waitFor(
      () =>
        api.edited.some((entry) => entry.text === 'Hello from OmniCode') ||
        api.sent.some((entry) => entry.text === 'Hello from OmniCode'),
    );
    expect(api.sendMessageAttempts).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const state = JSON.parse(await readFile(join(homeDir, 'telegram-state.json'), 'utf8')) as {
      metrics?: { retries?: number };
    };
    expect(state.metrics?.retries ?? 0).toBeGreaterThan(0);
  });

  it('validates the webhook secret and processes an update', async () => {
    await pair();
    await service.saveSettings({
      botToken: TOKEN,
      mode: 'webhook',
      webhookUrl: 'https://example.com/telegram',
      webhookSecret: 's3cret',
    });
    await service.start();

    const rejected = await service.handleWebhookUpdate(
      { update_id: 1, message: { chat: { id: CHAT_ID }, text: `/start ${pairingCode}` } },
      'wrong',
    );
    expect(rejected).toBe(false);

    const accepted = await service.handleWebhookUpdate(
      { update_id: 2, message: { chat: { id: CHAT_ID }, text: `/start ${pairingCode}` } },
      's3cret',
    );
    expect(accepted).toBe(true);

    const config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      allowedChatIds?: number[];
    };
    expect(config.allowedChatIds).toContain(CHAT_ID);
    expect((await service.status()).lastUpdateAt).toBeTypeOf('number');
  });

  it('processes a duplicate webhook update once', async () => {
    await pair();
    await service.saveSettings({
      botToken: TOKEN,
      mode: 'webhook',
      webhookUrl: 'https://example.com/telegram',
      webhookSecret: 's3cret',
    });

    const update = {
      update_id: 77,
      message: { message_id: 1, chat: { id: CHAT_ID }, text: '/help' },
    };
    await service.handleWebhookUpdate(update, 's3cret');
    await service.handleWebhookUpdate(update, 's3cret');

    const helpReplies = api.sent.filter((entry) =>
      entry.text.startsWith('OmniCode Telegram:'),
    );
    expect(helpReplies).toHaveLength(1);
  });

  it('refuses webhook updates when the connector is not in webhook mode', async () => {
    await pair();

    const accepted = await service.handleWebhookUpdate({ update_id: 1 }, 's3cret');

    expect(accepted).toBe(false);
  });

  it('refuses webhook updates when no webhook secret is configured', async () => {
    await pair();
    await service.saveSettings({
      botToken: TOKEN,
      mode: 'webhook',
      webhookUrl: 'https://example.com/telegram',
    });

    const withValue = await service.handleWebhookUpdate({ update_id: 1 }, 'anything');
    const withoutValue = await service.handleWebhookUpdate({ update_id: 2 }, undefined);

    expect(withValue).toBe(false);
    expect(withoutValue).toBe(false);
  });

  it('refuses to start webhook mode without a secret', async () => {
    await pair();
    await service.saveSettings({
      botToken: TOKEN,
      mode: 'webhook',
      webhookUrl: 'https://example.com/telegram',
    });

    await expect(service.start()).rejects.toThrow(/webhook secret/i);
  });

  it('refuses a media album from a chat that is not paired', async () => {
    await pair();
    const stranger = 424242;
    api.push([
      {
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: stranger },
          media_group_id: 'album-1',
          photo: [{ file_id: 'photo-a', file_size: 3 }],
        },
      },
      {
        update_id: 2,
        message: {
          message_id: 2,
          chat: { id: stranger },
          media_group_id: 'album-1',
          photo: [{ file_id: 'photo-b', file_size: 3 }],
        },
      },
    ]);
    await service.start();

    await waitFor(
      () => api.sent.filter((entry) => entry.text.includes('not paired')).length >= 2,
    );

    expect(lastSubmit).toBeUndefined();
    expect(await service.listBindings()).toEqual({});
  });

  it('ignores an inline button press from a chat that is not paired', async () => {
    await pair();
    api.push([
      {
        update_id: 1,
        callback_query: {
          id: 'callback-1',
          data: 's:session-1',
          message: { message_id: 1, chat: { id: 424242 } },
        },
      },
    ]);
    await service.start();

    await waitFor(() => api.answers.includes('This chat is not paired'));

    expect(await service.listBindings()).toEqual({});
  });

  it('delivers a pending question without the agent event bus', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: '/bind' } }]);
    await service.start();
    await waitFor(() => api.sent.some((entry) => entry.text.startsWith('Session:')));

    const payload = {
      questions: [{ question: 'Fallback?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    };
    const answered = interactions.request({
      id: 'q-fallback',
      kind: 'question',
      payload,
      tags: {
        [INTERACTION_TAG_AGENT_ID]: 'main',
        [INTERACTION_TAG_SESSION_ID]: 'session-1',
      },
    });

    await waitFor(() =>
      api.bodies.some((body) => JSON.stringify(body).includes('q:q-fallback:0:0')),
    );

    api.push([
      {
        update_id: 2,
        callback_query: {
          id: 'cb-fallback',
          data: 'q:q-fallback:0:1',
          message: { message_id: 1, chat: { id: CHAT_ID } },
        },
      },
    ]);

    await expect(answered).resolves.toEqual({ answers: { 'Fallback?': 'No' } });
  });

  it('creates and binds a new session with /new', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: '/new' } }]);
    await service.start();

    await waitFor(() => api.sent.some((entry) => entry.text.startsWith('New session:')));

    const config = JSON.parse(await readFile(join(homeDir, 'telegram.json'), 'utf8')) as {
      bindings?: Record<string, { sessionId?: string }>;
    };
    expect(config.bindings?.[String(CHAT_ID)]?.sessionId).toBe('session-1');
  });

  it('sends the last 5 messages after switching sessions', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    memoryHistory = Array.from({ length: 6 }, (_value, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `message-${String(index + 1)}` }],
    }));
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: '/bind' } }]);
    await service.start();
    await waitFor(() => api.sent.some((entry) => entry.text.startsWith('Session:')));

    const historyMessage = api.sent.find((entry) => entry.text.startsWith('Session:'));
    expect(historyMessage?.text).toContain('message-2');
    expect(historyMessage?.text).toContain('message-6');
    expect(historyMessage?.text).not.toContain('message-1');
  });

  it('shows a chat notice when a memory is saved', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    memorySaved = {
      content: 'the deploy target is staging',
      category: 'fact',
      trust: 'trusted',
    };
    api.push([{ update_id: 1, message: { chat: { id: CHAT_ID }, text: 'hello' } }]);
    await service.start();

    await waitFor(() =>
      api.sent.some((entry) => entry.text.startsWith('🧠 Memory saved')),
    );
    const notice = api.sent.find((entry) => entry.text.startsWith('🧠 Memory saved'));
    expect(notice?.text).toContain('the deploy target is staging');
  });

  it('groups an album into one prompt', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          media_group_id: 'album-1',
          caption: 'album caption',
          photo: [{ file_id: 'p1', file_size: 3 }],
        },
      },
    ]);
    api.push([
      {
        update_id: 2,
        message: {
          chat: { id: CHAT_ID },
          media_group_id: 'album-1',
          video: { file_id: 'v2', file_size: 3, mime_type: 'video/mp4' },
        },
      },
    ]);
    await service.start();

    await waitFor(() => lastSubmit !== undefined);

    const content = (lastSubmit as { message: { content: unknown[] } }).message.content;
    expect(content).toContainEqual(expect.objectContaining({ type: 'image_url' }));
    expect(content).toContainEqual(expect.objectContaining({ type: 'video_url' }));
    expect(content).toContainEqual({ type: 'text', text: 'album caption' });
    expect(mediaInputs).toHaveLength(2);
  });

  it('rejects files over the Telegram download limit', async () => {
    await pair();
    await service.addAllowedChat(CHAT_ID);
    api.push([
      {
        update_id: 1,
        message: {
          chat: { id: CHAT_ID },
          photo: [{ file_id: 'huge', file_size: 21 * 1024 * 1024 }],
        },
      },
    ]);
    await service.start();

    await waitFor(() => lastSubmit !== undefined);

    const content = (lastSubmit as { message: { content: unknown[] } }).message.content;
    expect(content).not.toContainEqual(expect.objectContaining({ type: 'image_url' }));
    expect(content).toContainEqual(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('20 MB download limit'),
      }),
    );
  });

  it('resumes from the persisted update offset after a restart', async () => {
    await pair();
    api.push([
      { update_id: 1, message: { chat: { id: CHAT_ID }, text: `/start ${pairingCode}` } },
    ]);
    api.push([
      { update_id: 2, message: { message_id: 10, chat: { id: CHAT_ID }, text: 'hello' } },
    ]);
    await service.start();

    await waitFor(
      () =>
        api.edited.some((entry) => entry.text === 'Hello from OmniCode') ||
        api.sent.some((entry) => entry.text === 'Hello from OmniCode'),
    );

    const progress = api.bodies.find((body) => body['text'] === 'OmniCode is working…');
    expect(progress?.['reply_parameters']).toEqual({
      message_id: 10,
      allow_sending_without_reply: true,
    });
    expect(api.chatActions).toContain('typing');
    expect(api.reactions).toContain('👀');
    expect(api.reactions).toContain('👍');
    await service.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));

    api.offsets.length = 0;
    await service.start();
    await waitFor(() => api.offsets.includes(3));
  });
});
