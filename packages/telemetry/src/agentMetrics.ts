import { track } from './client';
import type { TelemetryProperties } from './types';

export const AGENT_TELEMETRY_EVENTS = Object.freeze({
  turn: 'agent.turn',
  tool: 'agent.tool',
  permission: 'agent.permission',
  memoryRecall: 'agent.memory.recall',
  sandbox: 'agent.sandbox',
  channel: 'agent.channel',
});

export interface AgentTurnMetric {
  readonly durationMs: number;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly toolCalls: number;
  readonly retries?: number;
}

export interface AgentToolMetric {
  readonly toolName: string;
  readonly durationMs: number;
  readonly status: 'ok' | 'error' | 'denied' | 'aborted';
  readonly outputChars?: number;
  readonly truncated?: boolean;
}

export interface AgentPermissionMetric {
  readonly mode: 'manual' | 'auto' | 'yolo';
  readonly decision: 'approve' | 'ask' | 'deny';
  readonly policy: string;
  readonly toolName: string;
}

export interface AgentMemoryRecallMetric {
  readonly purpose: string;
  readonly status: string;
  readonly resultCount: number;
  readonly durationMs: number;
  readonly tokens?: number;
}

export interface AgentSandboxMetric {
  readonly mode: 'off' | 'auto' | 'required';
  readonly backend: 'bwrap' | 'landlock' | 'none';
  readonly outcome: 'sandboxed' | 'direct' | 'denied' | 'fallback';
}

export interface AgentChannelMetric {
  readonly channel: string;
  readonly outcome: 'started' | 'stopped' | 'send_ok' | 'send_failed' | 'rate_limited' | 'replay' | 'signature_failed';
}

export function agentTurnProperties(input: AgentTurnMetric): TelemetryProperties {
  return {
    duration_ms: bounded(input.durationMs),
    status: input.status,
    tool_calls: bounded(input.toolCalls),
    retries: bounded(input.retries ?? 0),
  };
}

export function agentToolProperties(input: AgentToolMetric): TelemetryProperties {
  return {
    tool: safeName(input.toolName),
    duration_ms: bounded(input.durationMs),
    status: input.status,
    output_chars: bounded(input.outputChars ?? 0),
    truncated: input.truncated === true,
  };
}

export function agentPermissionProperties(input: AgentPermissionMetric): TelemetryProperties {
  return {
    mode: input.mode,
    decision: input.decision,
    policy: safeName(input.policy),
    tool: safeName(input.toolName),
  };
}

export function agentMemoryRecallProperties(input: AgentMemoryRecallMetric): TelemetryProperties {
  return {
    purpose: safeName(input.purpose),
    status: safeName(input.status),
    result_count: bounded(input.resultCount),
    duration_ms: bounded(input.durationMs),
    tokens: bounded(input.tokens ?? 0),
  };
}

export function agentSandboxProperties(input: AgentSandboxMetric): TelemetryProperties {
  return { mode: input.mode, backend: input.backend, outcome: input.outcome };
}

export function agentChannelProperties(input: AgentChannelMetric): TelemetryProperties {
  return { channel: safeName(input.channel), outcome: input.outcome };
}

export function trackAgentTurn(input: AgentTurnMetric): void {
  track(AGENT_TELEMETRY_EVENTS.turn, agentTurnProperties(input));
}

export function trackAgentTool(input: AgentToolMetric): void {
  track(AGENT_TELEMETRY_EVENTS.tool, agentToolProperties(input));
}

export function trackAgentPermission(input: AgentPermissionMetric): void {
  track(AGENT_TELEMETRY_EVENTS.permission, agentPermissionProperties(input));
}

export function trackAgentMemoryRecall(input: AgentMemoryRecallMetric): void {
  track(AGENT_TELEMETRY_EVENTS.memoryRecall, agentMemoryRecallProperties(input));
}

export function trackAgentSandbox(input: AgentSandboxMetric): void {
  track(AGENT_TELEMETRY_EVENTS.sandbox, agentSandboxProperties(input));
}

export function trackAgentChannel(input: AgentChannelMetric): void {
  track(AGENT_TELEMETRY_EVENTS.channel, agentChannelProperties(input));
}

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120);
}
