import { describe, expect, it, vi } from 'vitest';

import { OtlpHttpSender } from '../src/otlpSender';

function sender(overrides: Partial<ConstructorParameters<typeof OtlpHttpSender>[0]> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200 });
  });
  const instance = new OtlpHttpSender({
    endpoint: 'http://collector:4318',
    serviceName: 'omnicode',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    ...overrides,
  });
  return { instance, calls, fetchImpl };
}

describe('OtlpHttpSender', () => {
  it('posts traces and metrics to signal paths', async () => {
    const { instance, calls } = sender();
    expect(await instance.send('traces', { a: 1 })).toMatchObject({ sent: true });
    expect(await instance.send('metrics', { b: 2 })).toMatchObject({ sent: true });
    expect(calls.map((call) => call.url)).toEqual([
      'http://collector:4318/v1/traces',
      'http://collector:4318/v1/metrics',
    ]);
  });

  it('does nothing without an endpoint', async () => {
    const { instance, fetchImpl } = sender({ endpoint: undefined });
    expect(await instance.send('traces', {})).toEqual({ sent: false, reason: 'no-endpoint' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves the endpoint and token per send', async () => {
    let endpoint: string | undefined = 'http://a';
    let token: string | null = 't1';
    const { instance, calls } = sender({
      endpoint: () => endpoint,
      getAccessToken: () => token,
    });
    await instance.send('traces', {});
    endpoint = 'http://b';
    token = null;
    await instance.send('traces', {});
    expect(calls[0]?.url.startsWith('http://a')).toBe(true);
    expect(calls[1]?.url.startsWith('http://b')).toBe(true);
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer t1');
    expect((calls[1]?.init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('retries 5xx but not 4xx', async () => {
    const retry = vi.fn(async () => new Response('', { status: 503 }));
    const { instance } = sender({ fetchImpl: retry as unknown as typeof fetch });
    expect(await instance.send('traces', {})).toMatchObject({ sent: false, reason: 'http-error', status: 503 });
    expect(retry).toHaveBeenCalledTimes(4);

    const reject = vi.fn(async () => new Response('', { status: 401 }));
    const second = sender({ fetchImpl: reject as unknown as typeof fetch }).instance;
    expect(await second.send('traces', {})).toMatchObject({ sent: false, status: 401 });
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it('never throws on network failure', async () => {
    const onError = vi.fn();
    const { instance } = sender({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      onError,
    });
    await expect(instance.flush({}, {})).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});
