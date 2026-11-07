import { describe, expect, it } from 'vitest';

import { consumeStream } from '#/llm/protocol/stream';
import type { StreamParseSink, StreamParser } from '#/llm/protocol/format';
import type { LlmRequestEvent } from '#/llm/requester/requester';
import {
  isRetryableError,
  MAX_RETRY_AFTER_MS,
  readRetryAfterMs,
  retryDelayMs,
} from '#/llm/requester/retry';

const BASE_BACKOFF_MS = 500;
const MAX_DELAY_MS = 32_000;

type Chunk = { kind: 'delta'; text: string } | { kind: 'finish' };

function parser(): StreamParser<Chunk> {
  return (chunk: Chunk, sink: StreamParseSink) => {
    if (chunk.kind === 'delta') {
      sink.onDelta?.({ type: 'text', text: chunk.text });
      return;
    }
    sink.onFinish({ finishReason: 'completed', rawFinishReason: 'stop' });
  };
}

async function* streamOf(chunks: readonly Chunk[]): AsyncIterable<Chunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect(chunks: readonly Chunk[]): Promise<readonly LlmRequestEvent[]> {
  const events: LlmRequestEvent[] = [];
  await consumeStream<Chunk>(streamOf(chunks), parser(), (event) => events.push(event));
  return events;
}

describe('incomplete stream guard', () => {
  it('completes normally when a finish event arrives', async () => {
    const events = await collect([{ kind: 'delta', text: 'hello' }, { kind: 'finish' }]);
    expect(events.at(-1)).toEqual({ type: 'llm.done' });
    expect(events.some((event) => event.type === 'llm.failed.remote')).toBe(false);
    expect(events.some((event) => event.type === 'llm.streaming.finish')).toBe(true);
  });

  it('fails the stream instead of completing when no finish event arrives', async () => {
    const events = await collect([{ kind: 'delta', text: 'half a sen' }]);
    const failure = events.at(-1);
    expect(events.some((event) => event.type === 'llm.done')).toBe(false);
    expect(failure?.type).toBe('llm.failed.remote');
    if (failure?.type !== 'llm.failed.remote') throw new Error('expected a remote failure');
    expect(failure.error.kind).toBe('incomplete_stream');
    expect(failure.error.message).toContain('before a finish event');
  });

  it('fails an empty stream that never finished', async () => {
    const events = await collect([]);
    expect(events.at(-1)?.type).toBe('llm.failed.remote');
  });

  it('preserves the deltas that did arrive before the cut', async () => {
    const events = await collect([{ kind: 'delta', text: 'partial' }]);
    const deltas = events.filter((event) => event.type === 'llm.streaming.part');
    expect(deltas).toHaveLength(1);
  });

  it('treats an incomplete stream as retryable', () => {
    expect(isRetryableError({ kind: 'incomplete_stream', message: 'cut' })).toBe(true);
  });

  it('does not reclassify a stream that a provider already failed', async () => {
    const events: LlmRequestEvent[] = [];
    const failing: StreamParser<Chunk> = (_chunk, sink) => {
      sink.onError({ kind: 'provider', message: 'upstream exploded' });
    };
    await consumeStream<Chunk>(streamOf([{ kind: 'delta', text: 'x' }]), failing, (event) =>
      events.push(event),
    );
    const failure = events.at(-1);
    expect(failure?.type).toBe('llm.failed.remote');
    if (failure?.type !== 'llm.failed.remote') throw new Error('expected a remote failure');
    expect(failure.error.kind).toBe('provider');
  });

  it('reads a Retry-After hint when the provider supplies one', () => {
    expect(
      readRetryAfterMs({
        kind: 'rate_limit',
        message: 'slow down',
        statusCode: 429,
        requestId: null,
        retryAfterMs: 5_000,
        headers: null,
      }),
    ).toBe(5_000);
  });
});
describe('retry delay budget', () => {
  it('falls back to backoff when the provider gives no hint', () => {
    const delay = retryDelayMs(3, undefined);
    expect(delay).toBeGreaterThanOrEqual(BASE_BACKOFF_MS * 2 ** 3);
    expect(delay).toBeLessThanOrEqual(MAX_DELAY_MS * 1.25);
  });

  it('honors a Retry-After the provider sends, even below the backoff', () => {
    expect(retryDelayMs(5, 1)).toBe(1);
    expect(retryDelayMs(0, 30_000)).toBe(30_000);
  });

  it('caps an unbounded Retry-After so a session cannot be stalled', () => {
    expect(retryDelayMs(0, 24 * 60 * 60_000)).toBe(MAX_RETRY_AFTER_MS);
    expect(MAX_RETRY_AFTER_MS).toBe(15 * 60_000);
  });
});

