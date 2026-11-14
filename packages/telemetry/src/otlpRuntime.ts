/**
 * Process-wide OTLP emission runtime.
 *
 * Emitters (engine, tools, hosts) call `recordOtlpSpan` / `recordOtlpMetric`
 * without knowing whether OTLP is configured; a host turns the runtime on once
 * with `configureOtlpRuntime` and flushes or shuts it down on exit. An absent
 * endpoint means the runtime stays off — records are dropped, never buffered
 * against a future configuration, and no default collector is ever assumed.
 *
 * Recording is synchronous, bounded by the exporter's caps, and can never
 * throw; flushing swallows every failure. Observability must not be able to
 * fail a turn, a tool call, or shutdown.
 */

import {
  DEFAULT_MAX_BUFFERED_METRIC_POINTS,
  DEFAULT_MAX_BUFFERED_SPANS,
  DEFAULT_MAX_METRIC_SERIES,
  METRIC_ATTRIBUTE_ALLOWLIST,
  OtlpExporter,
  SPAN_ATTRIBUTE_ALLOWLIST,
  type OtlpExportedMetric,
  type OtlpExportedSpan,
} from './otlp';
import { OtlpHttpSender, type OtlpSignal } from './otlpSender';

export type OtlpRuntimeStatus = 'ok' | 'error' | 'unset';

export interface OtlpRuntimeSpanInput {
  readonly name: string;
  readonly status: OtlpRuntimeStatus;
  readonly durationMs: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface OtlpRuntimeMetricInput {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface OtlpRuntimeOptions {
  /** Collector base URL; signal paths are appended. Undefined/empty keeps the runtime off. */
  readonly endpoint?: string | (() => string | undefined) | undefined;
  readonly serviceName?: string;
  readonly getAccessToken?: () => string | null | Promise<string | null>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly flushIntervalMs?: number;
  readonly maxBufferedSpans?: number;
  readonly maxBufferedPointsPerMetric?: number;
  readonly maxMetricSeries?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onError?: (error: unknown, signal: OtlpSignal) => void;
}

export const DEFAULT_OTLP_SERVICE_NAME = 'omnicode';
export const DEFAULT_OTLP_FLUSH_INTERVAL_MS = 30_000;
export const OTLP_SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

interface OtlpRuntimeState {
  readonly exporter: OtlpExporter;
  readonly sender: OtlpHttpSender;
  flushTimer: ReturnType<typeof setInterval> | null;
  flushInFlight: boolean;
}

let state: OtlpRuntimeState | undefined;

export function configureOtlpRuntime(options: OtlpRuntimeOptions): void {
  teardown();
  const endpoint = options.endpoint;
  if (endpoint === undefined) return;
  if (typeof endpoint === 'string' && endpoint.length === 0) return;
  const exporter = new OtlpExporter({
    allowedSpanAttributes: SPAN_ATTRIBUTE_ALLOWLIST,
    allowedMetricAttributes: METRIC_ATTRIBUTE_ALLOWLIST,
    maxMetricSeries: options.maxMetricSeries ?? DEFAULT_MAX_METRIC_SERIES,
    maxBufferedSpans: options.maxBufferedSpans ?? DEFAULT_MAX_BUFFERED_SPANS,
    maxBufferedPointsPerMetric:
      options.maxBufferedPointsPerMetric ?? DEFAULT_MAX_BUFFERED_METRIC_POINTS,
  });
  const sender = new OtlpHttpSender({
    endpoint,
    serviceName: options.serviceName ?? DEFAULT_OTLP_SERVICE_NAME,
    getAccessToken: options.getAccessToken,
    headers: options.headers,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    onError: options.onError,
  });
  const next: OtlpRuntimeState = { exporter, sender, flushTimer: null, flushInFlight: false };
  const flushIntervalMs = options.flushIntervalMs;
  if (
    flushIntervalMs !== undefined &&
    Number.isInteger(flushIntervalMs) &&
    flushIntervalMs >= 1
  ) {
    next.flushTimer = setInterval(() => {
      void flushOtlpRuntime();
    }, flushIntervalMs);
    next.flushTimer.unref?.();
  }
  state = next;
}

export function isOtlpRuntimeConfigured(): boolean {
  return state !== undefined;
}

export function recordOtlpSpan(span: OtlpRuntimeSpanInput): void {
  const current = state;
  if (current === undefined) return;
  try {
    const endMs = Date.now();
    const durationMs = Number.isFinite(span.durationMs) ? Math.max(0, span.durationMs) : 0;
    current.exporter.exportSpan({
      name: span.name,
      startTimeUnixNano: unixNano(endMs - durationMs),
      endTimeUnixNano: unixNano(endMs),
      attributes: span.attributes ?? {},
      status: span.status,
    });
  } catch {}
}

export function recordOtlpMetric(metric: OtlpRuntimeMetricInput): void {
  const current = state;
  if (current === undefined) return;
  try {
    current.exporter.exportMetric({
      name: metric.name,
      value: metric.value,
      ...(metric.unit === undefined ? {} : { unit: metric.unit }),
      attributes: metric.attributes ?? {},
      timeUnixNano: unixNano(Date.now()),
    });
  } catch {}
}

/**
 * Sends the buffered signals. Each signal's batch is drained before its send
 * and restored on failure, so a signal that was not accepted keeps its data for
 * the next flush and nothing recorded after serialization is silently reset
 * away. Overlapping flushes are skipped: the flush already in flight owns the
 * drained batches, and a second one would double-post the same payload.
 * Never throws; a no-op when nothing is buffered or the runtime is off.
 */
export async function flushOtlpRuntime(): Promise<void> {
  const current = state;
  if (current === undefined || current.flushInFlight) return;
  current.flushInFlight = true;
  let spanBatch: OtlpExportedSpan[] = [];
  let metricBatch: OtlpExportedMetric[] = [];
  let tracesSent = false;
  let metricsSent = false;
  try {
    spanBatch = current.exporter.takeSpans();
    metricBatch = current.exporter.takeMetrics();
    if (spanBatch.length === 0 && metricBatch.length === 0) return;
    const spans =
      spanBatch.length > 0
        ? current.exporter.toResourceSpansJson(current.sender.serviceName, spanBatch)
        : undefined;
    const metrics =
      metricBatch.length > 0
        ? current.exporter.toResourceMetricsJson(current.sender.serviceName, metricBatch)
        : undefined;
    const tracesResult =
      spans === undefined ? undefined : await current.sender.send('traces', spans);
    const metricsResult =
      metrics === undefined ? undefined : await current.sender.send('metrics', metrics);
    tracesSent = tracesResult?.sent === true;
    metricsSent = metricsResult?.sent === true;
  } catch {
    // Fall through: unconfirmed batches are restored below.
  } finally {
    if (!tracesSent && spanBatch.length > 0) current.exporter.restoreSpans(spanBatch);
    if (!metricsSent && metricBatch.length > 0) current.exporter.restoreMetrics(metricBatch);
    current.flushInFlight = false;
  }
}

export async function shutdownOtlpRuntime(
  options: { readonly flush?: boolean; readonly timeoutMs?: number } = {},
): Promise<void> {
  const current = state;
  if (current === undefined) return;
  state = undefined;
  if (current.flushTimer !== null) {
    clearInterval(current.flushTimer);
    current.flushTimer = null;
  }
  if (options.flush === false) return;
  const timeoutMs =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0
      ? options.timeoutMs
      : OTLP_SHUTDOWN_FLUSH_TIMEOUT_MS;
  if (timeoutMs === 0) return;
  await Promise.race([
    flushCaptured(current),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function flushCaptured(current: OtlpRuntimeState): Promise<void> {
  try {
    const spanBatch = current.exporter.takeSpans();
    const metricBatch = current.exporter.takeMetrics();
    const spans =
      spanBatch.length > 0
        ? current.exporter.toResourceSpansJson(current.sender.serviceName, spanBatch)
        : undefined;
    const metrics =
      metricBatch.length > 0
        ? current.exporter.toResourceMetricsJson(current.sender.serviceName, metricBatch)
        : undefined;
    await current.sender.flush(spans, metrics);
  } catch {}
}

export interface OtlpRuntimeBufferCounts {
  readonly spans: number;
  readonly metricPoints: number;
  readonly droppedSpans: number;
  readonly droppedMetricPoints: number;
}

/** Buffer diagnostic; undefined while the runtime is off. */
export function otlpRuntimeBufferCounts(): OtlpRuntimeBufferCounts | undefined {
  const current = state;
  if (current === undefined) return undefined;
  return {
    spans: current.exporter.spanCount(),
    metricPoints: current.exporter.metricPointCount(),
    droppedSpans: current.exporter.droppedSpanCount(),
    droppedMetricPoints: current.exporter.droppedMetricPointCount(),
  };
}

function teardown(): void {
  const current = state;
  if (current === undefined) return;
  state = undefined;
  if (current.flushTimer !== null) {
    clearInterval(current.flushTimer);
    current.flushTimer = null;
  }
}

function unixNano(ms: number): string {
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}
