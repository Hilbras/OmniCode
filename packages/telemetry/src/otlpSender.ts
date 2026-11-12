/**
 * OTLP/HTTP sender.
 *
 * The exporter builds payloads; this ships them. It is intentionally small and
 * deliberately dumb about success: an unset endpoint means "not configured, do
 * nothing" (never fall back to a default collector), a non-2xx response is
 * retried with bounded backoff, and every failure is swallowed. Observability
 * must never be able to fail a turn, a tool call, or shutdown.
 *
 * The auth token is resolved per send rather than captured, so a login/logout
 * takes effect without rebuilding the sender, and the token never lands in the
 * payload itself.
 */

export const OTLP_RETRY_BACKOFFS_MS = [250, 1_000, 4_000] as const;
export const OTLP_REQUEST_TIMEOUT_MS = 10_000;

export interface OtlpSenderOptions {
  /** Collector base URL; signal-specific paths are appended. */
  readonly endpoint?: string | (() => string | undefined) | undefined;
  readonly serviceName: string;
  readonly getAccessToken?: () => string | null | Promise<string | null>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
  readonly retryBackoffsMs?: readonly number[];
  readonly requestTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onError?: (error: unknown, signal: 'traces' | 'metrics') => void;
}

export type OtlpSignal = 'traces' | 'metrics';

export interface OtlpSendResult {
  readonly sent: boolean;
  readonly status?: number;
  readonly reason?: 'no-endpoint' | 'http-error' | 'network-error' | 'disabled';
}

const SIGNAL_PATH: Record<OtlpSignal, string> = {
  traces: '/v1/traces',
  metrics: '/v1/metrics',
};

export class OtlpHttpSender {
  private readonly endpoint: OtlpSenderOptions['endpoint'];
  readonly serviceName: string;
  private readonly getAccessToken: OtlpSenderOptions['getAccessToken'];
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly retryBackoffsMs: readonly number[];
  private readonly requestTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onError: OtlpSenderOptions['onError'];

  constructor(options: OtlpSenderOptions) {
    this.endpoint = options.endpoint;
    this.serviceName = options.serviceName;
    this.getAccessToken = options.getAccessToken;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.retryBackoffsMs = options.retryBackoffsMs ?? OTLP_RETRY_BACKOFFS_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? OTLP_REQUEST_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onError = options.onError;
  }

  /** Posts one payload; never throws. */
  async send(signal: OtlpSignal, payload: object): Promise<OtlpSendResult> {
    const base = typeof this.endpoint === 'function' ? this.endpoint() : this.endpoint;
    if (base === undefined || base.length === 0) return { sent: false, reason: 'no-endpoint' };

    const url = `${base.replace(/\/+$/, '')}${SIGNAL_PATH[signal]}`;
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt <= this.retryBackoffsMs.length; attempt += 1) {
      if (attempt > 0) await this.sleep(this.retryBackoffsMs[attempt - 1]!);
      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          ...this.headers,
        };
        const token = await this.getAccessToken?.();
        if (typeof token === 'string' && token.length > 0) headers['authorization'] = `Bearer ${token}`;
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        if (response.ok) return { sent: true, status: response.status };
        lastStatus = response.status;
        // 4xx is a caller error (bad payload/auth); retrying cannot fix it.
        if (response.status >= 400 && response.status < 500) {
          return { sent: false, status: response.status, reason: 'http-error' };
        }
      } catch (error) {
        this.onError?.(error, signal);
      }
    }
    return lastStatus === undefined
      ? { sent: false, reason: 'network-error' }
      : { sent: false, status: lastStatus, reason: 'http-error' };
  }

  /** Flushes a payload pair; best-effort, never throws. */
  async flush(spans: object | undefined, metrics: object | undefined): Promise<void> {
    try {
      if (spans !== undefined) await this.send('traces', spans);
      if (metrics !== undefined) await this.send('metrics', metrics);
    } catch (error) {
      this.onError?.(error, spans === undefined ? 'metrics' : 'traces');
    }
  }
}
