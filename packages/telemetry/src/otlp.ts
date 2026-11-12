/**
 * OTLP/HTTP export primitives.
 *
 * The telemetry package owns transport; this module owns the *shape* of what
 * leaves the process. Two rules decide every field here:
 *
 * 1. Redaction. An OTEL attribute is free-form, which is exactly how prompt
 *    text, file paths, and tokens end up in a backend. Only primitives on an
 *    explicit allowlist shape survive; nested objects, arrays, and unknown
 *    keys are dropped rather than stringified.
 * 2. Cardinality. Metric series are bounded per name; once a cap is hit new
 *    attribute sets are folded into an `overflow` series, so one runaway label
 *    cannot melt the backend or the local buffer.
 *
 * The exporter is transport-agnostic: the caller supplies a sender, so tests
 * never open a socket and the host decides auth and endpoints.
 */

export type OtlpAttributeValue = string | number | boolean;

export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanInput {
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly status: SpanStatus;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface MetricPointInput {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly timeUnixNano: string;
}

export interface OtlpExporterOptions {
  /** Attribute keys a span may carry. Anything else is dropped. */
  readonly allowedSpanAttributes: readonly string[];
  /** Attribute keys a metric point may carry. Anything else is dropped. */
  readonly allowedMetricAttributes: readonly string[];
  /** Distinct attribute sets per metric name; extra sets fold into overflow. */
  readonly maxMetricSeries?: number;
  /** Spans buffered before the oldest is dropped. */
  readonly maxBufferedSpans?: number;
}

export const DEFAULT_MAX_METRIC_SERIES = 500;
export const DEFAULT_MAX_BUFFERED_SPANS = 1_000;

export const SPAN_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  'agent.id',
  'agent.role',
  'session.id',
  'turn.id',
  'tool.name',
  'tool.source',
  'tool.outcome',
  'tool.duration_ms',
  'llm.provider',
  'llm.model_alias',
  'llm.input_tokens',
  'llm.output_tokens',
  'llm.cost_usd',
  'llm.retry_count',
  'approval.decision',
  'approval.policy',
  'sandbox.backend',
  'sandbox.mode',
  'compaction.count',
  'compaction.tokens_before',
  'compaction.tokens_after',
  'memory.recall.hits',
  'memory.recall.trust',
  'fallback.from',
  'fallback.to',
  'fallback.reason',
  'feature.name',
];

export const METRIC_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  'agent.id',
  'tool.name',
  'tool.outcome',
  'llm.provider',
  'llm.model_alias',
  'approval.decision',
  'sandbox.backend',
  'fallback.reason',
];

function isPrimitive(value: unknown): value is OtlpAttributeValue {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** Keeps only allowed, primitive attributes; everything else is dropped. */
export function redactAttributes(
  attributes: Readonly<Record<string, unknown>>,
  allowlist: readonly string[],
): Record<string, OtlpAttributeValue> {
  const allowed = new Set(allowlist);
  const out: Record<string, OtlpAttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowed.has(key)) continue;
    if (!isPrimitive(value)) continue;
    out[key] = value;
  }
  return out;
}

export interface OtlpExportedSpan {
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: Record<string, OtlpAttributeValue>;
  readonly status: { readonly code: 'OK' | 'ERROR' | 'UNSET' };
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface OtlpExportedMetric {
  readonly name: string;
  readonly unit?: string;
  readonly points: readonly {
    readonly value: number;
    readonly timeUnixNano: string;
    readonly attributes: Record<string, OtlpAttributeValue>;
  }[];
}

export class OtlpExporter {
  private readonly spans: OtlpExportedSpan[] = [];
  private readonly metrics = new Map<string, { unit?: string; points: OtlpExportedMetric['points'][number][] }>();
  private readonly series = new Map<string, Set<string>>();
  private readonly options: Required<Omit<OtlpExporterOptions, 'allowedSpanAttributes' | 'allowedMetricAttributes'>> &
    Pick<OtlpExporterOptions, 'allowedSpanAttributes' | 'allowedMetricAttributes'>;
  private droppedSpans = 0;
  private overflowedSeries = 0;

  constructor(options: OtlpExporterOptions) {
    this.options = {
      allowedSpanAttributes: options.allowedSpanAttributes,
      allowedMetricAttributes: options.allowedMetricAttributes,
      maxMetricSeries: positive(options.maxMetricSeries, DEFAULT_MAX_METRIC_SERIES),
      maxBufferedSpans: positive(options.maxBufferedSpans, DEFAULT_MAX_BUFFERED_SPANS),
    };
  }

  exportSpan(span: SpanInput): void {
    const attributes = redactAttributes(span.attributes, this.options.allowedSpanAttributes);
    this.spans.push({
      name: span.name,
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.endTimeUnixNano,
      attributes,
      status: { code: statusCode(span.status) },
      ...(span.traceId === undefined ? {} : { traceId: span.traceId }),
      ...(span.spanId === undefined ? {} : { spanId: span.spanId }),
    });
    if (this.spans.length > this.options.maxBufferedSpans) {
      this.spans.shift();
      this.droppedSpans += 1;
    }
  }

  exportMetric(point: MetricPointInput): void {
    if (!Number.isFinite(point.value)) return;
    const attributes = redactAttributes(point.attributes, this.options.allowedMetricAttributes);
    const seriesKey = seriesKeyOf(point.name, attributes);
    const seen = this.series.get(point.name) ?? new Set<string>();
    this.series.set(point.name, seen);

    let effectiveAttributes = attributes;
    if (!seen.has(seriesKey)) {
      if (seen.size >= this.options.maxMetricSeries) {
        // Fold into one overflow series instead of growing without bound.
        effectiveAttributes = { overflow: 'true' };
        this.overflowedSeries += 1;
      } else {
        seen.add(seriesKey);
      }
    }

    const entry = this.metrics.get(point.name) ?? { unit: point.unit, points: [] };
    if (entry.unit === undefined && point.unit !== undefined) entry.unit = point.unit;
    entry.points.push({ value: point.value, timeUnixNano: point.timeUnixNano, attributes: effectiveAttributes });
    this.metrics.set(point.name, entry);
  }

  spanCount(): number {
    return this.spans.length;
  }

  droppedSpanCount(): number {
    return this.droppedSpans;
  }

  overflowedSeriesCount(): number {
    return this.overflowedSeries;
  }

  /** OTLP/HTTP JSON body; the caller posts it and decides the endpoint. */
  toResourceSpansJson(serviceName: string): object {
    return {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeSpans: [{ spans: this.spans.map(spanToJson) }],
        },
      ],
    };
  }

  toResourceMetricsJson(serviceName: string): object {
    return {
      resourceMetrics: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeMetrics: [
            {
              metrics: [...this.metrics.entries()].map(([name, entry]) => ({
                name,
                ...(entry.unit === undefined ? {} : { unit: entry.unit }),
                gauge: {
                  dataPoints: entry.points.map((point) => ({
                    timeUnixNano: point.timeUnixNano,
                    asDouble: point.value,
                    attributes: Object.entries(point.attributes).map(([key, value]) => ({
                      key,
                      value: attributeValueToJson(value),
                    })),
                  })),
                },
              })),
            },
          ],
        },
      ],
    };
  }

  reset(): void {
    this.spans.length = 0;
    this.metrics.clear();
    this.series.clear();
    this.droppedSpans = 0;
    this.overflowedSeries = 0;
  }
}

function spanToJson(span: OtlpExportedSpan): object {
  return {
    name: span.name,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    status: { code: span.status.code },
    ...(span.traceId === undefined ? {} : { traceId: span.traceId }),
    ...(span.spanId === undefined ? {} : { spanId: span.spanId }),
    attributes: Object.entries(span.attributes).map(([key, value]) => ({
      key,
      value: attributeValueToJson(value),
    })),
  };
}

function attributeValueToJson(value: OtlpAttributeValue): object {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  return { stringValue: value };
}

function statusCode(status: SpanStatus): 'OK' | 'ERROR' | 'UNSET' {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'error':
      return 'ERROR';
    case 'unset':
      return 'UNSET';
  }
}

function seriesKeyOf(name: string, attributes: Record<string, OtlpAttributeValue>): string {
  return `${name}|${Object.keys(attributes)
    .sort()
    .map((key) => `${key}=${String(attributes[key])}`)
    .join(',')}`;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}
