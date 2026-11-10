import type {
  IMemoryService,
  MemoryCaptureResult,
  MemoryTaskStateInput,
} from '#/contracts/memoryContract';
import type { MemoryEvidence, MemoryScope } from '#/contracts/memoryTypes';

/**
 * The task state a full-compaction summary yields. The summary's section
 * headings are fixed by `compaction-instruction.md`; everything else in it is
 * model prose and is deliberately not extracted.
 */
export interface CompactionTaskState {
  readonly objective: string;
  readonly completed: readonly string[];
  readonly active: readonly string[];
  readonly decisions: readonly string[];
  readonly blockers: readonly string[];
  readonly nextSteps: readonly string[];
  readonly fileRefs: readonly string[];
}

const NO_ITEMS = /^\(none\)$/i;
const BULLET = /^(?:[-*+]|\d+\.)\s+(.*)$/;

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase();
}

function bulletText(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  const match = BULLET.exec(trimmed);
  const body = (match === null ? trimmed : (match[1] ?? '')).trim();
  if (body.length === 0 || NO_ITEMS.test(body)) return undefined;
  return body;
}

function collect(target: Map<string, string[]>, heading: string, line: string): void {
  const item = bulletText(line);
  if (item === undefined) return;
  const bucket = target.get(heading);
  if (bucket === undefined) target.set(heading, [item]);
  else bucket.push(item);
}

function fileRefFrom(item: string): string | undefined {
  const quoted = /`([^`]+)`/.exec(item);
  if (quoted !== null && quoted[1] !== undefined && quoted[1].trim().length > 0) return quoted[1].trim();
  const colon = item.indexOf(':');
  if (colon <= 0) return undefined;
  const candidate = item.slice(0, colon).trim();
  return candidate.length === 0 ? undefined : candidate;
}

/**
 * Reads the section headings the compaction instruction asks for. A summary
 * that omits a section yields an empty list for it; a summary that does not
 * follow the template at all yields `undefined` so the caller can skip the
 * write instead of storing an empty task state.
 */
export function parseCompactionSummary(summary: string): CompactionTaskState | undefined {
  const sections = new Map<string, string[]>();
  const workState = new Map<string, string[]>();
  let heading: string | undefined;
  let subheading: string | undefined;

  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('### ')) {
      subheading = normalizeHeading(line.slice(4));
      continue;
    }
    if (line.startsWith('## ')) {
      heading = normalizeHeading(line.slice(3));
      subheading = undefined;
      continue;
    }
    if (heading === undefined) continue;
    if (heading === 'work state') {
      if (subheading !== undefined) collect(workState, subheading, line);
      continue;
    }
    if (subheading === undefined) collect(sections, heading, line);
  }

  const objective = (sections.get('objective') ?? []).join(' ').trim();
  const completed = workState.get('completed') ?? [];
  const active = workState.get('active') ?? [];
  const decisions = sections.get('decisions') ?? [];
  const blockers = workState.get('blocked') ?? [];
  const nextSteps = sections.get('next move') ?? [];
  const fileRefs = (sections.get('relevant files') ?? [])
    .map(fileRefFrom)
    .filter((ref): ref is string => ref !== undefined);

  if (
    objective.length === 0 &&
    completed.length === 0 &&
    active.length === 0 &&
    decisions.length === 0 &&
    blockers.length === 0 &&
    nextSteps.length === 0 &&
    fileRefs.length === 0
  ) {
    return undefined;
  }

  return {
    objective: objective.length === 0 ? 'Task state captured at compaction' : objective,
    completed,
    active,
    decisions,
    blockers,
    nextSteps,
    fileRefs,
  };
}

export function toTaskStateInput(
  state: CompactionTaskState,
  input: {
    readonly taskId: string;
    readonly scope: MemoryScope;
    readonly evidence?: readonly MemoryEvidence[];
    readonly ttlMs?: number;
  },
): MemoryTaskStateInput {
  return {
    objective: state.objective,
    completed: state.completed,
    active: state.active,
    decisions: state.decisions,
    failedAttempts: [],
    blockers: state.blockers,
    fileRefs: state.fileRefs,
    nextAction: state.nextSteps.length === 0 ? undefined : state.nextSteps.join('; '),
    taskId: input.taskId,
    scope: input.scope,
    evidence: input.evidence,
    ttlMs: input.ttlMs,
  };
}

/**
 * Stores the summary as the session's task state. `saveTaskState` upserts on
 * `task_state:<taskId>` inside the scope, so a later compaction replaces the
 * previous record instead of appending another one.
 */
export async function captureCompactionTaskState(
  service: IMemoryService,
  input: {
    readonly taskId: string;
    readonly scope: MemoryScope;
    readonly summary: string;
    readonly evidence?: readonly MemoryEvidence[];
    readonly ttlMs?: number;
  },
): Promise<MemoryCaptureResult | undefined> {
  const state = parseCompactionSummary(input.summary);
  if (state === undefined) return undefined;
  return service.saveTaskState(toTaskStateInput(state, input));
}
