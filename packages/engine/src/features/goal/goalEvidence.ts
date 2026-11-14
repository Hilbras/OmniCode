import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

import type { ToolAccesses } from '#/tool/toolContract';

import type { VerificationEvidence } from './verifier';

/**
 * Runtime-observed evidence for goal verification.
 *
 * Records are captured by the runtime (executor tool observations), never by
 * the model: provenance, exit codes, and timestamps are assigned at capture
 * time, so a completion claim can only reference observations the runtime
 * actually made. The store is bounded and in memory per agent scope.
 */

export interface StoredGoalEvidence extends VerificationEvidence {
  readonly goalId: string;
}

export interface GoalEvidenceRecordInput {
  readonly goalId: string;
  readonly source: VerificationEvidence['source'];
  readonly claim: string;
  readonly provenance: string;
  readonly exitCode?: number | undefined;
  readonly observer?: VerificationEvidence['observer'];
  readonly observedAt?: number;
}

export interface IAgentGoalEvidenceService {
  readonly _serviceBrand: undefined;

  /** Records one evidence observation; provenance-free runs are refused. */
  record(input: GoalEvidenceRecordInput): StoredGoalEvidence;

  /** Chronological runtime evidence; the newest record is last. */
  list(): readonly StoredGoalEvidence[];

  latest(): StoredGoalEvidence | undefined;

  clear(): void;
}

export const IAgentGoalEvidenceService = createDecorator<IAgentGoalEvidenceService>(
  'agentGoalEvidenceService',
);

export const GOAL_EVIDENCE_MAX_RECORDS = 32;
const COMMAND_PROVENANCE_MAX_CHARS = 200;
const CLAIM_MAX_CHARS = 160;

/** A shell command whose outcome the runtime can vouch for. */
const SHELL_TOOL_NAMES = new Set<string>(['Bash']);
const READ_TOOL_NAMES = new Set<string>(['Read']);

export interface RuntimeToolObservation {
  readonly toolName: string;
  readonly args: unknown;
  readonly output: unknown;
  readonly isError?: boolean | undefined;
  readonly accesses?: ToolAccesses | undefined;
}

const EXIT_CODE_FAILURE_PATTERN = /(?:Command failed with|Failed with) exit code: (\d+)/;

/**
 * Maps one executed tool call to a provenance-tagged evidence record, or
 * `undefined` when the call is not an observation the verifier accepts.
 * Only fully attested records are produced: a run whose exit code cannot be
 * observed is dropped rather than recorded with a guessed exit code.
 */
export function evidenceFromToolObservation(
  observation: RuntimeToolObservation,
  now: number,
  index: number,
): VerificationEvidence | undefined {
  if (observation.isError === true && SHELL_TOOL_NAMES.has(observation.toolName)) {
    const command = plainString(observation.args, 'command');
    if (command === undefined) return undefined;
    const exitCode = parseFailureExitCode(toolOutputText(observation.output));
    if (exitCode === undefined) return undefined;
    return {
      id: `ev-${String(index)}`,
      claim: clip(`Command failed: ${command}`, CLAIM_MAX_CHARS),
      source: 'command_run',
      provenance: clip(command, COMMAND_PROVENANCE_MAX_CHARS),
      exitCode,
      observer: 'runtime',
      observedAt: now,
    };
  }
  if (observation.isError === true) return undefined;
  if (SHELL_TOOL_NAMES.has(observation.toolName)) {
    const command = plainString(observation.args, 'command');
    if (command === undefined) return undefined;
    return {
      id: `ev-${String(index)}`,
      claim: clip(`Command exited 0: ${command}`, CLAIM_MAX_CHARS),
      source: 'command_run',
      provenance: clip(command, COMMAND_PROVENANCE_MAX_CHARS),
      exitCode: 0,
      observer: 'runtime',
      observedAt: now,
    };
  }
  if (READ_TOOL_NAMES.has(observation.toolName)) {
    const path = observedReadPath(observation) ?? plainString(observation.args, 'path');
    if (path === undefined) return undefined;
    return {
      id: `ev-${String(index)}`,
      claim: clip(`Read ${path}`, CLAIM_MAX_CHARS),
      source: 'file_read',
      provenance: clip(path, COMMAND_PROVENANCE_MAX_CHARS),
      observer: 'runtime',
      observedAt: now,
    };
  }
  return undefined;
}

function observedReadPath(observation: RuntimeToolObservation): string | undefined {
  for (const access of observation.accesses ?? []) {
    if (access.kind === 'file' && (access.operation === 'read' || access.operation === 'readwrite')) {
      return access.path;
    }
  }
  return undefined;
}

function parseFailureExitCode(text: string): number | undefined {
  const match = EXIT_CODE_FAILURE_PATTERN.exec(text);
  if (match === null) return undefined;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : undefined;
}

function plainString(args: unknown, key: string): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const raw = (args as Readonly<Record<string, unknown>>)[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
}

function toolOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  return output
    .map((part) =>
      typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
        ? String((part as { text?: unknown }).text ?? '')
        : '',
    )
    .join('');
}

function clip(value: string, maxChars: number): string {
  const collapsed = value.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars)}…`;
}
