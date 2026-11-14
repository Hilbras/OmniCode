import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureOtlpRuntime,
  flushOtlpRuntime,
  isOtlpRuntimeConfigured,
  otlpRuntimeBufferCounts,
  recordOtlpMetric,
  recordOtlpSpan,
  shutdownOtlpRuntime,
} from '../src/otlpRuntime';

interface CapturedRequest {
  readonly url: string;
  readonly body: unknown;
}

function captureFetch(status = 200) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{}', { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

async function configure(overrides: Parameters<typeof configureOtlpRuntime>[0] = {}) {
  const capture = captureFetch();
  configureOtlpRuntime({
    endpoint: 'http://collector:4318',
    serviceName: 'omnicode-test',
    fetchImpl: capture.fetchImpl,
    ...overrides,
  });
  return capture;
}

function bodies(requests: readonly CapturedRequest[]): unknown[] {
  return requests.map((request) => request.body);
}

afterEach(async () => {
  await shutdownOtlpRuntime({ flush: false });
});

describe('OTLP runtime', () => {
  it('drops records while unconfigured', async () => {
    expect(isOtlpRuntimeConfigured()).toBe(false);
    expect(() => recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 })).not.toThrow();
    expect(() => recordOtlpMetric({ name: 'llm.tokens.input', value: 1 })).not.toThrow();
    await expect(flushOtlpRuntime()).resolves.toBeUndefined();
  });

  it('stays off when the endpoint is missing or empty', async () => {
    configure({ endpoint: undefined });
    expect(isOtlpRuntimeConfigured()).toBe(false);
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
    await shutdownOtlpRuntime({ flush: false });

    const capture = await configure({ endpoint: '' });
    expect(isOtlpRuntimeConfigured()).toBe(false);
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
    await flushOtlpRuntime();
    expect(capture.requests).toEqual([]);
  });

  it('flushes buffered spans and metrics to the signal paths, then resets', async () => {
    const capture = await configure();
    recordOtlpSpan({
      name: 'agent.turn',
      status: 'ok',
      durationMs: 12,
      attributes: { 'turn.id': 3, 'agent.id': 'a1' },
    });
    recordOtlpMetric({
      name: 'llm.tokens.input',
      value: 42,
      attributes: { 'llm.model_alias': 'gpt' },
    });
    await flushOtlpRuntime();
    expect(capture.requests.map((request) => request.url)).toEqual([
      'http://collector:4318/v1/traces',
      'http://collector:4318/v1/metrics',
    ]);
    const [traces, metrics] = bodies(capture.requests) as [
      { resourceSpans: unknown },
      { resourceMetrics: unknown },
    ];
    expect(traces.resourceSpans).toBeDefined();
    expect(metrics.resourceMetrics).toBeDefined();
    expect(JSON.stringify(traces)).toContain('"agent.turn"');
    expect(JSON.stringify(metrics)).toContain('llm.tokens.input');
    expect(JSON.stringify(metrics)).toContain('"gpt"');

    await flushOtlpRuntime();
    expect(capture.requests).toHaveLength(2);
  });

  it('keeps data buffered when a send fails so the next flush retries it', async () => {
    const requests: CapturedRequest[] = [];
    let status = 500;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status });
    });
    configureOtlpRuntime({
      endpoint: 'http://collector:4318',
      serviceName: 'omnicode-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    recordOtlpSpan({ name: 'agent.tool', status: 'ok', durationMs: 5 });
    await flushOtlpRuntime();
    expect(requests).toHaveLength(4);
    status = 200;
    await flushOtlpRuntime();
    expect(requests).toHaveLength(5);
    expect(JSON.stringify(requests[4]?.body)).toContain('"agent.tool"');
  });

  it('sends the authorization header from the per-send token getter', async () => {
    const headers: string[] = [];
    let token: string | null = 'secret-token';
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      headers.push(String((init.headers as Record<string, string>)['authorization'] ?? ''));
      return new Response('{}', { status: 200 });
    });
    configureOtlpRuntime({
      endpoint: 'http://collector:4318',
      serviceName: 'omnicode-test',
      getAccessToken: () => token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
    await flushOtlpRuntime();
    token = null;
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
    await flushOtlpRuntime();
    expect(headers).toEqual(['Bearer secret-token', '']);
  });

  it('clamps negative durations to a zero-length span', async () => {
    const capture = await configure();
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: -50 });
    await flushOtlpRuntime();
    const traces = capture.requests[0]?.body as {
      resourceSpans: readonly { scopeSpans: readonly { spans: readonly { startTimeUnixNano: string; endTimeUnixNano: string }[] }[] }[];
    };
    const span = traces.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.startTimeUnixNano).toBe(span?.endTimeUnixNano);
  });

  it('flushes on the configured interval and stops at shutdown', async () => {
    vi.useFakeTimers();
    try {
      const capture = await configure({ flushIntervalMs: 1000 });
      recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(capture.requests.map((request) => request.url)).toContain(
        'http://collector:4318/v1/traces',
      );
      recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
      await shutdownOtlpRuntime({ flush: false });
      expect(isOtlpRuntimeConfigured()).toBe(false);
      const count = capture.requests.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(capture.requests).toHaveLength(count);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconfiguration replaces the previous runtime', async () => {
    const first = await configure();
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
    const second = await configure();
    expect(isOtlpRuntimeConfigured()).toBe(true);
    recordOtlpSpan({ name: 'agent.tool', status: 'ok', durationMs: 1 });
    await flushOtlpRuntime();
    expect(first.requests).toEqual([]);
    expect(second.requests.map((request) => request.url)).toContain(
      'http://collector:4318/v1/traces',
    );
    expect(JSON.stringify(second.requests[0]?.body)).not.toContain('"agent.turn"');
  });

  it('shutdown sends the remaining data once and turns the runtime off', async () => {
    const capture = await configure();
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 2 });
    recordOtlpMetric({ name: 'llm.cost.usd', value: 0.5 });
    await shutdownOtlpRuntime();
    expect(isOtlpRuntimeConfigured()).toBe(false);
    expect(capture.requests.map((request) => request.url)).toEqual([
      'http://collector:4318/v1/traces',
      'http://collector:4318/v1/metrics',
    ]);
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 2 });
    await flushOtlpRuntime();
    expect(capture.requests).toHaveLength(2);
  });

  it('shutdown with flush disabled sends nothing', async () => {
    const capture = await configure();
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 2 });
    await shutdownOtlpRuntime({ flush: false });
    expect(capture.requests).toEqual([]);
    expect(isOtlpRuntimeConfigured()).toBe(false);
  });

  it('redacts span attributes to the allowlist', async () => {
    const capture = await configure();
    recordOtlpSpan({
      name: 'agent.tool',
      status: 'ok',
      durationMs: 3,
      attributes: {
        'tool.name': 'Bash',
        command: 'rm -rf /',
        path: '/home/user/secret',
        prompt: 'user text',
      },
    });
    await flushOtlpRuntime();
    const serialized = JSON.stringify(capture.requests[0]?.body);
    expect(serialized).toContain('Bash');
    expect(serialized).not.toContain('rm -rf');
    expect(serialized).not.toContain('/home/user/secret');
    expect(serialized).not.toContain('user text');
  });

  it('resets buffers per signal: a failed metrics send keeps only metrics for the next flush', async () => {
    const requests: CapturedRequest[] = [];
    let tracesStatus = 200;
    let metricsStatus = 500;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: url.endsWith('/v1/traces') ? tracesStatus : metricsStatus });
    });
    configureOtlpRuntime({
      endpoint: 'http://collector:4318',
      serviceName: 'omnicode-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 4 });
    recordOtlpMetric({ name: 'llm.tokens.input', value: 7 });

    await flushOtlpRuntime();
    const urls = requests.map((request) => request.url);
    expect(urls.filter((url) => url.endsWith('/v1/traces'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/v1/metrics'))).toHaveLength(4);

    metricsStatus = 200;
    await flushOtlpRuntime();
    const secondFlushUrls = requests.slice(urls.length).map((request) => request.url);
    expect(secondFlushUrls).toEqual(['http://collector:4318/v1/metrics']);
    expect(JSON.stringify(requests.at(-1)?.body)).toContain('llm.tokens.input');
    expect(JSON.stringify(requests.at(-1)?.body)).not.toContain('agent.turn');

    await flushOtlpRuntime();
    expect(requests).toHaveLength(urls.length + 1);
  });

  it('skips an overlapping flush while a send is in flight', async () => {
    let releaseTraces: (() => void) | undefined;
    let blockTraces = true;
    const requests: CapturedRequest[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/v1/traces') && blockTraces) {
        blockTraces = false;
        await new Promise<void>((resolve) => {
          releaseTraces = resolve;
        });
      }
      return new Response('{}', { status: 200 });
    });
    configureOtlpRuntime({
      endpoint: 'http://collector:4318',
      serviceName: 'omnicode-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    recordOtlpSpan({ name: 'agent.turn', status: 'ok', durationMs: 1 });
    const inFlight = flushOtlpRuntime();
    recordOtlpSpan({ name: 'agent.tool', status: 'ok', durationMs: 1 });

    await flushOtlpRuntime();
    expect(requests).toHaveLength(1);
    expect(otlpRuntimeBufferCounts()?.spans).toBe(1);

    releaseTraces?.();
    await inFlight;
    expect(requests).toHaveLength(1);
    expect(otlpRuntimeBufferCounts()?.spans).toBe(1);

    await flushOtlpRuntime();
    expect(requests).toHaveLength(2);
    expect(otlpRuntimeBufferCounts()?.spans).toBe(0);
  });

  it('bounds the metric buffer while the endpoint keeps failing', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    configureOtlpRuntime({
      endpoint: 'http://collector:4318',
      serviceName: 'omnicode-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxBufferedPointsPerMetric: 10,
    });
    for (let round = 0; round < 5; round += 1) {
      for (let index = 0; index < 30; index += 1) {
        recordOtlpMetric({ name: 'llm.tokens.input', value: index });
      }
      await flushOtlpRuntime();
    }

    const counts = otlpRuntimeBufferCounts();
    expect(counts?.metricPoints).toBe(10);
    expect(counts?.droppedMetricPoints).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
