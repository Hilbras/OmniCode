import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureOtlpRuntime,
  flushOtlpRuntime,
  isOtlpRuntimeConfigured,
  shutdownOtlpRuntime,
} from '@hilbras/omnicode-telemetry';

import type { TelemetryEventPayload } from '#/app/telemetry/events';
import { TelemetryService } from '#/app/telemetry/telemetryService';
import {
  OtlpTelemetryBridgeService,
  OTLP_METRIC_NAMES,
  OTLP_SPAN_NAMES,
  createOtlpAppender,
} from '#/app/telemetry/otlpAppender';

interface CapturedRequest {
  readonly url: string;
  readonly body: unknown;
}

interface ExportedSpan {
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly { readonly key: string; readonly value: Record<string, unknown> }[];
}

function configureRuntime(overrides: Parameters<typeof configureOtlpRuntime>[0] = {}) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{}', { status: 200 });
  });
  configureOtlpRuntime({
    endpoint: 'http://collector:4318',
    serviceName: 'engine-test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
  return requests;
}

function spansOf(requests: readonly CapturedRequest[]): readonly ExportedSpan[] {
  const traces = requests.find((request) => request.url.endsWith('/v1/traces'))?.body as
    | {
        resourceSpans?: readonly {
          scopeSpans?: readonly { spans?: readonly ExportedSpan[] }[];
        }[];
      }
    | undefined;
  return traces?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
}

function metricNamesOf(requests: readonly CapturedRequest[]): string[] {
  const metrics = requests.find((request) => request.url.endsWith('/v1/metrics'))?.body as
    | {
        resourceMetrics?: readonly {
          scopeMetrics?: readonly { metrics?: readonly { name: string }[] }[];
        }[];
      }
    | undefined;
  return (metrics?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics ?? []).map((metric) => metric.name);
}

function metricPointsOf(
  requests: readonly CapturedRequest[],
  name: string,
): readonly { asDouble: number; attributes: ExportedSpan['attributes'] }[] {
  const metrics = requests.find((request) => request.url.endsWith('/v1/metrics'))?.body as
    | {
        resourceMetrics?: readonly {
          scopeMetrics?: readonly {
            metrics?: readonly {
              name: string;
              gauge?: { dataPoints?: readonly { asDouble: number; attributes: ExportedSpan['attributes'] }[] };
            }[];
          }[];
        }[];
      }
    | undefined;
  const metric = metrics?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.find(
    (candidate) => candidate.name === name,
  );
  return metric?.gauge?.dataPoints ?? [];
}

function attributeValue(value: Record<string, unknown>): unknown {
  if ('stringValue' in value) return value['stringValue'];
  if ('doubleValue' in value) return value['doubleValue'];
  if ('boolValue' in value) return value['boolValue'];
  return undefined;
}

function attributeMap(span: ExportedSpan): Record<string, unknown> {
  return Object.fromEntries(
    span.attributes.map((attribute) => [attribute.key, attributeValue(attribute.value)]),
  );
}

function serviceWithOtlp(): TelemetryService {
  const svc = new TelemetryService();
  svc.addAppender(createOtlpAppender());
  svc.setContext({ session_id: 's1', agent_id: 'a1', provider_type: 'anthropic' });
  return svc;
}

afterEach(async () => {
  await shutdownOtlpRuntime({ flush: false });
  vi.unstubAllEnvs();
});

describe('OTLP telemetry appender', () => {
  it('records nothing while the OTLP runtime is unconfigured', () => {
    const svc = serviceWithOtlp();
    expect(() =>
      svc.track2('tool_call', {
        turn_id: 1,
        tool_call_id: 'c1',
        tool_name: 'Bash',
        outcome: 'success',
        duration_ms: 10,
        dup_type: 'normal',
      }),
    ).not.toThrow();
    expect(isOtlpRuntimeConfigured()).toBe(false);
  });

  it('projects turn, tool, and LLM events onto spans with allowlisted attributes', async () => {
    const requests = configureRuntime();
    const svc = serviceWithOtlp();
    svc.track2('turn_started', { turn_id: 1, mode: 'agent' });
    svc.track2('tool_call', {
      turn_id: 1,
      tool_call_id: 'c1',
      tool_name: 'Bash',
      outcome: 'success',
      duration_ms: 12,
      dup_type: 'normal',
    });
    const finished: TelemetryEventPayload<'llm_request_finished'> = {
      model: 'claude-x',
      alias: 'primary',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      duration_ms: 250,
      input_tokens: 100,
      output_tokens: 20,
      input_cache_read: 5,
      input_cache_creation: 7,
      turn_id: 1,
      request_kind: 'turn',
    };
    svc.track2('llm_request_finished', finished);
    svc.track2('turn_ended', {
      turn_id: 1,
      reason: 'completed',
      duration_ms: 900,
      mode: 'agent',
    });
    await flushOtlpRuntime();

    const names = spansOf(requests).map((span) => span.name);
    expect(names).toEqual([
      OTLP_SPAN_NAMES.tool,
      OTLP_SPAN_NAMES.llmRequest,
      OTLP_SPAN_NAMES.turn,
    ]);

    const toolSpan = spansOf(requests)[0];
    const toolAttributes = attributeMap(toolSpan!);
    expect(toolAttributes).toMatchObject({
      'agent.id': 'a1',
      'session.id': 's1',
      'tool.name': 'Bash',
      'tool.outcome': 'success',
      'tool.duration_ms': 12,
      'turn.id': 1,
    });
    expect(toolAttributes).not.toHaveProperty('tool_call_id');
    expect(toolAttributes).not.toHaveProperty('dup_type');

    const llmSpan = spansOf(requests)[1];
    expect(attributeMap(llmSpan!)).toMatchObject({
      'llm.provider': 'anthropic',
      'llm.model_alias': 'primary',
    });

    const turnSpan = spansOf(requests)[2];
    const turnAttributes = attributeMap(turnSpan!);
    expect(turnAttributes['turn.id']).toBe(1);
    const startNano = BigInt(turnSpan!.startTimeUnixNano);
    const endNano = BigInt(turnSpan!.endTimeUnixNano);
    expect(Number(endNano - startNano)).toBe(900_000_000);
  });

  it('records token, tool, turn, and request-kind metrics', async () => {
    const requests = configureRuntime();
    const svc = serviceWithOtlp();
    const finished: TelemetryEventPayload<'llm_request_finished'> = {
      model: 'claude-x',
      alias: 'primary',
      provider_type: 'anthropic',
      duration_ms: 250,
      input_tokens: 100,
      output_tokens: 20,
      input_cache_read: 5,
      input_cache_creation: 7,
      turn_id: 1,
    };
    svc.track2('llm_request_finished', finished);
    const failed: TelemetryEventPayload<'api_error'> = {
      error_type: 'rate_limit',
      model: 'claude-x',
      alias: 'primary',
      retryable: true,
      duration_ms: 40,
      provider_type: 'anthropic',
    };
    svc.track2('api_error', failed);
    svc.track2('turn_ended', {
      turn_id: 1,
      reason: 'completed',
      duration_ms: 900,
      mode: 'agent',
    });
    await flushOtlpRuntime();

    const names = metricNamesOf(requests);
    expect(names).toContain(OTLP_METRIC_NAMES.llmTokensInput);
    expect(names).toContain(OTLP_METRIC_NAMES.llmTokensOutput);
    expect(names).toContain(OTLP_METRIC_NAMES.llmTokensCacheRead);
    expect(names).toContain(OTLP_METRIC_NAMES.llmTokensCacheWrite);
    expect(names).toContain(OTLP_METRIC_NAMES.llmRequestErrors);
    expect(names).toContain(OTLP_METRIC_NAMES.turnDuration);

    const inputPoints = metricPointsOf(requests, OTLP_METRIC_NAMES.llmTokensInput);
    expect(inputPoints[0]?.asDouble).toBe(100);
    const attributes = Object.fromEntries(
      (inputPoints[0]?.attributes ?? []).map((attribute) => [
        attribute.key,
        attributeValue(attribute.value),
      ]),
    );
    expect(attributes).toMatchObject({ 'llm.provider': 'anthropic', 'llm.model_alias': 'primary' });

    const errorPoints = metricPointsOf(requests, OTLP_METRIC_NAMES.llmRequestErrors);
    expect(errorPoints[0]?.asDouble).toBe(1);
  });

  it('records retry, fallback, approval, and compaction metrics', async () => {
    const requests = configureRuntime();
    const svc = serviceWithOtlp();
    const retrying: TelemetryEventPayload<'turn_step_retrying'> = {
      turn_id: 1,
      step: 2,
      failed_attempt: 1,
      next_attempt: 2,
      max_attempts: 5,
      delay_ms: 500,
      error_type: 'rate_limit',
      status_code: 429,
    };
    svc.track2('turn_step_retrying', retrying);
    const fallback: TelemetryEventPayload<'model_fallback'> = {
      fallback_from: 'primary',
      fallback_to: 'secondary',
      reason: 'quota',
      turn_id: 1,
    };
    svc.track2('model_fallback', fallback);
    const approval: TelemetryEventPayload<'permission_approval_result'> = {
      turn_id: 1,
      tool_call_id: 'c1',
      policy_name: 'default-tool-approve',
      tool_name: 'Bash',
      permission_mode: 'auto',
      result: 'approved',
      approval_surface: 'tui',
      duration_ms: 120,
      session_cache_written: false,
      has_feedback: false,
    };
    svc.track2('permission_approval_result', approval);
    const compacted: TelemetryEventPayload<'compaction_finished'> = {
      turn_id: 1,
      source: 'auto',
      tokens_before: 900,
      tokens_after: 400,
      duration_ms: 1500,
      compacted_count: 12,
      retry_count: 0,
      round: 1,
      thinking_effort: 'high',
    };
    svc.track2('compaction_finished', compacted);
    await flushOtlpRuntime();

    const names = metricNamesOf(requests);
    expect(names).toContain(OTLP_METRIC_NAMES.llmRetries);
    expect(names).toContain(OTLP_METRIC_NAMES.modelFallback);
    expect(names).toContain(OTLP_METRIC_NAMES.approvalCount);
    expect(names).toContain(OTLP_METRIC_NAMES.compactionCount);
    expect(names).toContain(OTLP_METRIC_NAMES.compactionTokensBefore);
    expect(names).toContain(OTLP_METRIC_NAMES.compactionTokensAfter);

    const fallbackPoints = metricPointsOf(requests, OTLP_METRIC_NAMES.modelFallback);
    const fallbackAttributes = Object.fromEntries(
      (fallbackPoints[0]?.attributes ?? []).map((attribute) => [
        attribute.key,
        attributeValue(attribute.value),
      ]),
    );
    expect(fallbackAttributes).toEqual({
      'fallback.from': 'primary',
      'fallback.to': 'secondary',
      'fallback.reason': 'quota',
    });

    const approvalSpan = spansOf(requests).find((span) => span.name === OTLP_SPAN_NAMES.approval);
    expect(attributeMap(approvalSpan!)).toMatchObject({
      'approval.decision': 'approved',
      'approval.policy': 'default-tool-approve',
    });

    const compactionSpan = spansOf(requests).find((span) => span.name === OTLP_SPAN_NAMES.compaction);
    expect(attributeMap(compactionSpan!)).toMatchObject({ 'compaction.count': 12 });
  });

  it('records sandbox and memory recall signals', async () => {
    const requests = configureRuntime();
    const svc = serviceWithOtlp();
    svc.track2('sandbox_decision', { mode: 'auto', backend: 'bwrap', outcome: 'sandbox' });
    const recall: TelemetryEventPayload<'memory_recall'> = {
      purpose: 'explicit_search',
      status: 'complete',
      result_count: 3,
      duration_ms: 8,
      top_trust: 'trusted',
    };
    svc.track2('memory_recall', recall);
    await flushOtlpRuntime();

    const sandboxSpan = spansOf(requests).find((span) => span.name === OTLP_SPAN_NAMES.sandbox);
    expect(attributeMap(sandboxSpan!)).toMatchObject({
      'sandbox.backend': 'bwrap',
      'sandbox.mode': 'auto',
    });
    expect(metricNamesOf(requests)).toContain(OTLP_METRIC_NAMES.sandboxDecisions);

    const recallSpan = spansOf(requests).find((span) => span.name === OTLP_SPAN_NAMES.memoryRecall);
    expect(attributeMap(recallSpan!)).toMatchObject({
      'memory.recall.hits': 3,
      'memory.recall.trust': 'trusted',
    });
    const recallPoints = metricPointsOf(requests, OTLP_METRIC_NAMES.memoryRecallHits);
    const recallAttributes = Object.fromEntries(
      (recallPoints[0]?.attributes ?? []).map((attribute) => [
        attribute.key,
        attributeValue(attribute.value),
      ]),
    );
    expect(recallAttributes).toMatchObject({ 'memory.recall.status': 'complete' });
    expect(recallPoints[0]?.asDouble).toBe(3);
  });

  it('closes an interrupted turn with the measured wall duration from turn_started', async () => {
    vi.useFakeTimers();
    try {
      const requests = configureRuntime();
      const svc = serviceWithOtlp();
      const base = Date.now();
      vi.setSystemTime(base);
      svc.track2('turn_started', { turn_id: 2, mode: 'agent' });
      vi.setSystemTime(base + 700);
      svc.track2('turn_interrupted', { turn_id: 2, at_step: 1, mode: 'agent', interrupt_reason: 'user_cancelled' });
      await flushOtlpRuntime();

      const turnSpan = spansOf(requests).find((span) => span.name === OTLP_SPAN_NAMES.turn);
      const startNano = BigInt(turnSpan!.startTimeUnixNano);
      const endNano = BigInt(turnSpan!.endTimeUnixNano);
      expect(Number(endNano - startNano)).toBe(700_000_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops recording after the bridge service is disposed', async () => {
    const requests = configureRuntime();
    const telemetry = new TelemetryService();
    telemetry.setContext({ session_id: 's1', agent_id: 'a1' });
    const bridge = new OtlpTelemetryBridgeService(telemetry);
    telemetry.track2('turn_ended', { turn_id: 1, reason: 'completed', duration_ms: 5, mode: 'agent' });
    bridge.dispose();
    telemetry.track2('turn_ended', { turn_id: 2, reason: 'completed', duration_ms: 5, mode: 'agent' });
    await flushOtlpRuntime();

    const turnSpans = spansOf(requests).filter((span) => span.name === OTLP_SPAN_NAMES.turn);
    expect(turnSpans).toHaveLength(1);
  });
});
