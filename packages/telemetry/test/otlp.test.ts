import { describe, expect, it } from 'vitest';

import {
  METRIC_ATTRIBUTE_ALLOWLIST,
  OtlpExporter,
  SPAN_ATTRIBUTE_ALLOWLIST,
  redactAttributes,
} from '../src/otlp';

function exporter(overrides: Partial<ConstructorParameters<typeof OtlpExporter>[0]> = {}) {
  return new OtlpExporter({
    allowedSpanAttributes: SPAN_ATTRIBUTE_ALLOWLIST,
    allowedMetricAttributes: METRIC_ATTRIBUTE_ALLOWLIST,
    ...overrides,
  });
}

describe('redactAttributes', () => {
  it('keeps only allowlisted primitives', () => {
    expect(
      redactAttributes(
        {
          'tool.name': 'Read',
          'tool.duration_ms': 12,
          'tool.outcome': 'success',
          'file.path': '/etc/passwd',
          'tool.nested': { a: 1 },
          'tool.list': [1],
          'tool.nan': Number.NaN,
        },
        SPAN_ATTRIBUTE_ALLOWLIST,
      ),
    ).toEqual({ 'tool.name': 'Read', 'tool.duration_ms': 12, 'tool.outcome': 'success' });
  });
});

describe('OtlpExporter', () => {
  it('exports a redacted span and drops forbidden attributes', () => {
    const ex = exporter();
    ex.exportSpan({
      name: 'tool.execute',
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      status: 'ok',
      attributes: { 'tool.name': 'Bash', command: 'rm -rf /' },
    });
    const json = JSON.stringify(ex.toResourceSpansJson('omnicode'));
    expect(json).toContain('"tool.name"');
    expect(json).not.toContain('rm -rf');
    expect(json).toContain('"OK"');
  });

  it('bounds buffered spans, dropping the oldest', () => {
    const ex = exporter({ maxBufferedSpans: 2 });
    for (let i = 0; i < 4; i += 1) {
      ex.exportSpan({ name: `s${i}`, startTimeUnixNano: '1', endTimeUnixNano: '2', status: 'unset', attributes: {} });
    }
    expect(ex.spanCount()).toBe(2);
    expect(ex.droppedSpanCount()).toBe(2);
  });

  it('folds series beyond the cardinality cap into overflow', () => {
    const ex = exporter({ maxMetricSeries: 2 });
    for (const name of ['a', 'b', 'c', 'd']) {
      ex.exportMetric({ name: 'llm.calls', value: 1, timeUnixNano: '1', attributes: { 'tool.name': name } });
    }
    const json = JSON.stringify(ex.toResourceMetricsJson('omnicode'));
    expect(ex.overflowedSeriesCount()).toBe(2);
    expect(json).toContain('"overflow"');
  });

  it('ignores non-finite metric values', () => {
    const ex = exporter();
    ex.exportMetric({ name: 'x', value: Number.POSITIVE_INFINITY, timeUnixNano: '1', attributes: {} });
    expect(JSON.stringify(ex.toResourceMetricsJson('s'))).not.toContain('Infinity');
  });
});
