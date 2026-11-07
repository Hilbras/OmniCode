import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UNKNOWN_CAPABILITY } from '#/llm/capability';
import { createUserMessage, type Message } from '#/llm/message';
import type { LlmModel } from '#/llm/model';
import { createOpenAIRequester } from '#/llm/requester/bases/openai/requester';
import type { LlmRequester, LlmRequestEvent } from '#/llm/requester/requester';

import {
  CASSETTE_RECORD_ENV,
  cassetteModeFromEnv,
  isPreservedEnvKey,
  openFetchCassette,
  withFetchCassette,
} from './cassette';

const cassetteDir = fileURLToPath(new URL('./cassettes/', import.meta.url));

const model: LlmModel = {
  provider: 'test',
  model: 'gpt-5-mini',
  capability: UNKNOWN_CAPABILITY,
  baseUrl: 'https://example.test/v1',
  apiKey: 'YOUR_API_KEY',
};

const messages: readonly Message[] = [createUserMessage('hi')];

function cassetteFile(name: string): string {
  return join(cassetteDir, `${name}.json`);
}

function replay(name: string) {
  return { file: cassetteFile(name), name, mode: 'replay' as const };
}

async function generate(requester: LlmRequester): Promise<readonly LlmRequestEvent[]> {
  const events: LlmRequestEvent[] = [];
  await requester.generate(
    { model },
    { messages },
    { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
  );
  return events;
}

function textOf(events: readonly LlmRequestEvent[]): string {
  return events
    .filter((event) => event.type === 'llm.streaming.part')
    .map((event) => (event.part.type === 'text' ? event.part.text : ''))
    .join('');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetch cassette', () => {
  it('drives the real provider SDK from a recorded stream', async () => {
    const { events, calls } = await withFetchCassette(replay('openai-chat-stream'), async (cassette) => ({
      events: await generate(createOpenAIRequester()),
      calls: cassette.calls,
    }));

    expect(textOf(events)).toBe('Hello world');
    expect(events.at(-1)).toEqual({ type: 'llm.done' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.test/v1/chat/completions');
    expect(calls[0]?.headers['authorization']).toBe('[redacted]');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ model: 'gpt-5-mini', stream: true });
  });

  it('fails a recording that ends without a finish event', async () => {
    const events = await withFetchCassette(replay('openai-chat-truncated'), () =>
      generate(createOpenAIRequester()),
    );

    expect(textOf(events)).toBe('Partial');
    expect(events.at(-1)).toMatchObject({
      type: 'llm.failed.remote',
      error: { kind: 'incomplete_stream' },
    });
  });

  it('surfaces a missing recording entry instead of passing silently', async () => {
    const { events, missed } = await withFetchCassette(replay('openai-chat-stream'), async (cassette) => ({
      events: await (async () => {
        await generate(createOpenAIRequester());
        return generate(createOpenAIRequester());
      })(),
      missed: cassette.missed,
    }));

    expect(events.at(-1)).toMatchObject({ type: 'llm.failed.remote', error: { kind: 'connection' } });
    expect(missed).toHaveLength(1);
    expect(missed[0]).toContain('openai-chat-stream');
    expect(missed[0]).toContain('#1');
  });

  it('reports a missing cassette file by name', async () => {
    await expect(
      withFetchCassette(replay('no-such-cassette'), async () => undefined),
    ).rejects.toThrow(/no-such-cassette/);
  });

  it('records a response and replays it back', async () => {
    const file = join(tmpdir(), `cassette-${randomUUID()}.json`);
    const body = 'data: {"id":"chatcmpl-tmp","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const inner = async (): Promise<Response> =>
      new Response(body, { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });

    const recorder = await openFetchCassette({ file, name: 'tmp', mode: 'record', inner });
    const live = await recorder.fetch('https://example.test/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer YOUR_API_KEY', 'content-type': 'application/json' },
      body: '{"model":"gpt-5-mini"}',
    });
    expect(await live.text()).toBe(body);
    expect(recorder.mode).toBe('record');
    await recorder.flush();

    const onDisk = await readFile(file, 'utf8');
    expect(onDisk).not.toContain('YOUR_API_KEY');
    expect(JSON.parse(onDisk)).toMatchObject({
      version: 1,
      name: 'tmp',
      entries: [
        {
          key: 'POST https://example.test/v1/chat/completions',
          request: { headers: { authorization: '[redacted]' } },
          response: { status: 200 },
        },
      ],
    });

    const replayer = await openFetchCassette({ file, name: 'tmp', mode: 'replay' });
    const replayed = await replayer.fetch('https://example.test/v1/chat/completions', {
      method: 'POST',
      body: '{"model":"gpt-5-mini"}',
    });
    expect(await replayed.text()).toBe(body);
  });

  it('replays repeated identical requests in recorded order', async () => {
    const file = join(tmpdir(), `cassette-${randomUUID()}.json`);
    let call = 0;
    const inner = async (): Promise<Response> => {
      call += 1;
      return new Response(`chunk-${call}`, { status: 200 });
    };

    const recorder = await openFetchCassette({ file, name: 'tmp', mode: 'record', inner });
    const url = 'https://example.test/v1/chat/completions';
    expect(await (await recorder.fetch(url, { method: 'POST', body: '{}' })).text()).toBe('chunk-1');
    expect(await (await recorder.fetch(url, { method: 'POST', body: '{}' })).text()).toBe('chunk-2');
    await recorder.flush();

    const replayer = await openFetchCassette({ file, name: 'tmp', mode: 'replay' });
    expect(await (await replayer.fetch(url, { method: 'POST', body: '{}' })).text()).toBe('chunk-1');
    expect(await (await replayer.fetch(url, { method: 'POST', body: '{}' })).text()).toBe('chunk-2');
    await expect(replayer.fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow(/#2/);
  });

  it('records only the cassettes named by the recording variable', () => {
    expect(cassetteModeFromEnv('openai-chat-stream')).toBe('replay');

    vi.stubEnv(CASSETTE_RECORD_ENV, '1');
    expect(cassetteModeFromEnv('openai-chat-stream')).toBe('record');

    vi.stubEnv(CASSETTE_RECORD_ENV, 'openai-chat-truncated');
    expect(cassetteModeFromEnv('openai-chat-truncated')).toBe('record');
    expect(cassetteModeFromEnv('openai-chat-stream')).toBe('replay');

    vi.stubEnv(CASSETTE_RECORD_ENV, '0');
    expect(cassetteModeFromEnv('openai-chat-stream')).toBe('replay');
  });

  it('protects the recording variable from the suite environment wipe', () => {
    expect(isPreservedEnvKey(CASSETTE_RECORD_ENV)).toBe(true);
    expect(isPreservedEnvKey('OMNICODE_EXPERIMENTAL_MEMORY')).toBe(false);
    expect(isPreservedEnvKey('PATH')).toBe(false);
  });
});
