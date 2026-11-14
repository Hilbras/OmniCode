import { Service } from '@hilbras/omnicode-base/di/service';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { toDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { recordOtlpMetric, recordOtlpSpan } from '@hilbras/omnicode-telemetry';

import { LifecycleScope } from '#/app/scopes';

import type { TelemetryPrimitive } from './context';
import type { ITelemetryAppender, TelemetryAppenderRecord } from './telemetry';
import { ITelemetryService } from './telemetry';

/**
 * Projects the engine's typed telemetry stream onto OTLP spans and metrics.
 *
 * The engine never configures transport: until a host calls
 * `configureOtlpRuntime` (telemetry leaf) every record is a cheap no-op. When
 * a host configures it, this appender maps the events the engine already emits
 * — turn lifecycle, tool calls, LLM requests, approvals, compaction, sandbox
 * decisions, memory recall, cost — onto the span and metric names below. All
 * attribute keys must be on the leaf's allowlists; the exporter drops
 * everything else, and only classified enums, ids, counts, and durations are
 * ever supplied here.
 */

export const OTLP_SPAN_NAMES = Object.freeze({
  turn: 'agent.turn',
  tool: 'agent.tool',
  llmRequest: 'agent.llm_request',
  approval: 'agent.approval',
  compaction: 'agent.compaction',
  sandbox: 'agent.sandbox',
  memoryRecall: 'agent.memory_recall',
});

export const OTLP_METRIC_NAMES = Object.freeze({
  turnDuration: 'agent.turn.duration',
  toolCalls: 'agent.tool.calls',
  llmTokensInput: 'llm.tokens.input',
  llmTokensOutput: 'llm.tokens.output',
  llmTokensCacheRead: 'llm.tokens.cache_read',
  llmTokensCacheWrite: 'llm.tokens.cache_write',
  llmCost: 'llm.cost.usd',
  llmRetries: 'llm.retries',
  llmRequestErrors: 'llm.request.errors',
  approvalCount: 'agent.approval.count',
  permissionDecisions: 'agent.permission.decisions',
  compactionCount: 'compaction.count',
  compactionFailures: 'compaction.failures',
  compactionTokensBefore: 'compaction.tokens_before',
  compactionTokensAfter: 'compaction.tokens_after',
  modelFallback: 'model.fallback.count',
  sandboxDecisions: 'agent.sandbox.decisions',
  memoryRecallHits: 'memory.recall.hits',
});

const MAX_OPEN_TURNS = 128;

type TelemetryRecord = Record<string, TelemetryPrimitive>;

export function createOtlpAppender(): ITelemetryAppender {
  const openTurns = new Map<string, number>();
  return {
    track: (record: TelemetryAppenderRecord) => {
      trackRecord(record, openTurns);
    },
  };
}

function trackRecord(record: TelemetryAppenderRecord, openTurns: Map<string, number>): void {
  const base = baseAttributes(record);
  const properties = record.properties as TelemetryRecord;
  switch (record.event) {
    case 'turn_started':
      rememberOpenTurn(openTurns, openTurnKey(base, properties), Date.now());
      return;
    case 'turn_ended':
      closeTurnSpan(
        openTurns,
        base,
        properties,
        properties['reason'] === 'completed' ? 'ok' : properties['reason'] === 'failed' ? 'error' : 'unset',
        numberOr(properties['duration_ms'], 0),
      );
      return;
    case 'turn_interrupted':
      closeTurnSpan(openTurns, base, properties, 'unset', measuredTurnDuration(openTurns, base, properties));
      return;
    case 'tool_call':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.tool,
        status: toolSpanStatus(properties['outcome']),
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: {
          ...base,
          'tool.name': properties['tool_name'],
          'tool.outcome': properties['outcome'],
          'tool.duration_ms': properties['duration_ms'],
          'turn.id': properties['turn_id'],
        },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.toolCalls,
        value: 1,
        attributes: {
          ...base,
          'tool.name': properties['tool_name'],
          'tool.outcome': properties['outcome'],
        },
      });
      return;
    case 'api_error':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.llmRequest,
        status: 'error',
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: {
          ...base,
          'llm.provider': properties['provider_type'],
          'llm.model_alias': properties['alias'],
          'turn.id': properties['turn_id'],
        },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.llmRequestErrors,
        value: 1,
        attributes: {
          ...base,
          'llm.provider': properties['provider_type'],
          'llm.model_alias': properties['alias'],
        },
      });
      return;
    case 'llm_request_finished':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.llmRequest,
        status: 'ok',
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: {
          ...base,
          'llm.provider': properties['provider_type'],
          'llm.model_alias': properties['alias'],
          'turn.id': properties['turn_id'],
        },
      });
      recordTokens(properties, base);
      return;
    case 'turn_step_retrying':
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.llmRetries,
        value: 1,
        attributes: { ...base, 'llm.provider': record.context['provider_type'] },
      });
      return;
    case 'model_fallback':
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.modelFallback,
        value: 1,
        attributes: {
          'fallback.from': properties['fallback_from'],
          'fallback.to': properties['fallback_to'],
          'fallback.reason': properties['reason'],
        },
      });
      return;
    case 'cost_recorded':
      if (properties['priced'] === true) {
        recordOtlpMetric({
          name: OTLP_METRIC_NAMES.llmCost,
          value: numberOr(properties['cost_usd'], 0),
          unit: 'USD',
          attributes: { ...base, 'llm.model_alias': properties['model'] },
        });
      }
      return;
    case 'permission_approval_result':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.approval,
        status: properties['result'] === 'error' ? 'error' : 'ok',
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: {
          ...base,
          'approval.decision': properties['result'],
          'approval.policy': properties['policy_name'],
          'turn.id': properties['turn_id'],
        },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.approvalCount,
        value: 1,
        attributes: { ...base, 'approval.decision': properties['result'] },
      });
      return;
    case 'permission_policy_decision':
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.permissionDecisions,
        value: 1,
        attributes: { ...base, 'approval.decision': properties['decision'] },
      });
      return;
    case 'compaction_finished':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.compaction,
        status: 'ok',
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: {
          ...base,
          'compaction.count': properties['compacted_count'],
          'turn.id': properties['turn_id'],
        },
      });
      recordOtlpMetric({ name: OTLP_METRIC_NAMES.compactionCount, value: 1, attributes: { ...base } });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.compactionTokensBefore,
        value: numberOr(properties['tokens_before'], 0),
        attributes: { ...base },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.compactionTokensAfter,
        value: numberOr(properties['tokens_after'], 0),
        attributes: { ...base },
      });
      return;
    case 'compaction_failed':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.compaction,
        status: 'error',
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: { ...base, 'turn.id': properties['turn_id'] },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.compactionFailures,
        value: 1,
        attributes: { ...base },
      });
      return;
    case 'sandbox_decision':
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.sandbox,
        status: properties['outcome'] === 'denied' ? 'error' : 'ok',
        durationMs: 0,
        attributes: {
          ...base,
          'sandbox.backend': properties['backend'],
          'sandbox.mode': properties['mode'],
        },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.sandboxDecisions,
        value: 1,
        attributes: { ...base, 'sandbox.backend': properties['backend'] },
      });
      return;
    case 'memory_recall': {
      const hits = numberOr(properties['result_count'], 0);
      recordOtlpSpan({
        name: OTLP_SPAN_NAMES.memoryRecall,
        status: 'ok',
        durationMs: numberOr(properties['duration_ms'], 0),
        attributes: {
          ...base,
          'memory.recall.hits': hits,
          'memory.recall.trust': properties['top_trust'],
        },
      });
      recordOtlpMetric({
        name: OTLP_METRIC_NAMES.memoryRecallHits,
        value: hits,
        attributes: { ...base, 'memory.recall.status': properties['status'] },
      });
      return;
    }
    default:
      return;
  }
}

function recordTokens(properties: TelemetryRecord, base: Record<string, unknown>): void {
  const attributes = {
    ...base,
    'llm.provider': properties['provider_type'],
    'llm.model_alias': properties['alias'],
  };
  recordOtlpMetric({
    name: OTLP_METRIC_NAMES.llmTokensInput,
    value: numberOr(properties['input_tokens'], 0),
    unit: 'tokens',
    attributes,
  });
  recordOtlpMetric({
    name: OTLP_METRIC_NAMES.llmTokensOutput,
    value: numberOr(properties['output_tokens'], 0),
    unit: 'tokens',
    attributes,
  });
  recordOtlpMetric({
    name: OTLP_METRIC_NAMES.llmTokensCacheRead,
    value: numberOr(properties['input_cache_read'], 0),
    unit: 'tokens',
    attributes,
  });
  recordOtlpMetric({
    name: OTLP_METRIC_NAMES.llmTokensCacheWrite,
    value: numberOr(properties['input_cache_creation'], 0),
    unit: 'tokens',
    attributes,
  });
}

function baseAttributes(record: TelemetryAppenderRecord): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  const agentId = record.context['agent_id'];
  if (typeof agentId === 'string') attributes['agent.id'] = agentId;
  const sessionId = record.context['session_id'];
  if (typeof sessionId === 'string') attributes['session.id'] = sessionId;
  return attributes;
}

function openTurnKey(base: Record<string, unknown>, properties: TelemetryRecord): string {
  return `${String(base['agent.id'] ?? '')}|${String(properties['turn_id'] ?? '')}`;
}

function rememberOpenTurn(openTurns: Map<string, number>, key: string, startedAtMs: number): void {
  if (openTurns.size >= MAX_OPEN_TURNS) {
    const oldest = openTurns.keys().next();
    if (oldest.done !== true) openTurns.delete(oldest.value);
  }
  openTurns.set(key, startedAtMs);
}

function measuredTurnDuration(
  openTurns: Map<string, number>,
  base: Record<string, unknown>,
  properties: TelemetryRecord,
): number {
  const startedAt = openTurns.get(openTurnKey(base, properties));
  return startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt);
}

function closeTurnSpan(
  openTurns: Map<string, number>,
  base: Record<string, unknown>,
  properties: TelemetryRecord,
  status: 'ok' | 'error' | 'unset',
  durationMs: number,
): void {
  openTurns.delete(openTurnKey(base, properties));
  recordOtlpSpan({
    name: OTLP_SPAN_NAMES.turn,
    status,
    durationMs,
    attributes: { ...base, 'turn.id': properties['turn_id'] },
  });
  recordOtlpMetric({
    name: OTLP_METRIC_NAMES.turnDuration,
    value: durationMs,
    unit: 'ms',
    attributes: { ...base },
  });
}

function toolSpanStatus(outcome: TelemetryPrimitive): 'ok' | 'error' | 'unset' {
  if (outcome === 'success') return 'ok';
  if (outcome === 'error') return 'error';
  return 'unset';
}

function numberOr(value: TelemetryPrimitive, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface IOtlpTelemetryBridgeService {
  readonly _serviceBrand: undefined;
}

export const IOtlpTelemetryBridgeService = createDecorator<IOtlpTelemetryBridgeService>(
  'otlpTelemetryBridgeService',
);

export class OtlpTelemetryBridgeService extends Service implements IOtlpTelemetryBridgeService {
  declare readonly _serviceBrand: undefined;

  constructor(@ITelemetryService telemetry: ITelemetryService) {
    super();
    const appender = createOtlpAppender();
    telemetry.addAppender(appender);
    this._register(toDisposable(() => telemetry.removeAppender(appender)));
  }
}

registerScopedService(
  LifecycleScope.App,
  IOtlpTelemetryBridgeService,
  OtlpTelemetryBridgeService,
  ScopeActivation.OnScopeCreated,
  'otlpTelemetryBridge',
);
