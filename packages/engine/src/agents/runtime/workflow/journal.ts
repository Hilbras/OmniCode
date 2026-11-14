import { z } from 'zod';

import { Error2 } from '#/errors';

import { WorkflowErrors } from './errors';

export type WorkflowJournalEntryType =
  | 'workflow.started'
  | 'workflow.resumed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'step.refused'
  | 'step.skipped'
  | 'step.stalled'
  | 'workflow.completed'
  | 'workflow.failed';

export type WorkflowRefusalReason =
  | 'tool-not-allowed'
  | 'budget-estimate-missing'
  | 'budget-exhausted';

const workflowRefusalReasonSchema = z.enum([
  'tool-not-allowed',
  'budget-estimate-missing',
  'budget-exhausted',
]);

const workflowJournalEntrySchema = z.discriminatedUnion('type', [
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('workflow.started'),
    workflowId: z.string().min(1),
    fingerprint: z.string().min(1),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('workflow.resumed'),
    fromSeq: z.number().int().finite().nonnegative(),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('step.started'),
    stepId: z.string().min(1),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('step.completed'),
    stepId: z.string().min(1),
    tokensUsed: z.number().finite().nonnegative().optional(),
    summary: z.string().optional(),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('step.failed'),
    stepId: z.string().min(1),
    error: z.string().optional(),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('step.refused'),
    stepId: z.string().min(1),
    reason: workflowRefusalReasonSchema,
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('step.skipped'),
    stepId: z.string().min(1),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('step.stalled'),
    stepId: z.string().min(1),
    afterMs: z.number().finite().nonnegative(),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('workflow.completed'),
  }),
  z.object({
    seq: z.number().int().finite().nonnegative(),
    at: z.number().finite().nonnegative(),
    type: z.literal('workflow.failed'),
    reason: z.string().min(1),
  }),
]);

export type WorkflowJournalEntry = z.infer<typeof workflowJournalEntrySchema>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type WorkflowJournalAppend = DistributiveOmit<WorkflowJournalEntry, 'seq' | 'at'>;

export function parseWorkflowJournalEntries(input: unknown): readonly WorkflowJournalEntry[] {
  const parsed = workflowJournalEntrySchema.array().safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error2(
      WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID,
      `Invalid workflow journal: ${issue === undefined ? 'schema mismatch' : `entry ${String(issue.path[0] ?? '?')} ${issue.message}`}`,
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
  const entries = parsed.data;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      throw new Error2(
        WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID,
        `Workflow journal must be contiguous from seq 1: expected ${String(expectedSeq)}, found ${String(entry.seq)}.`,
        { details: { expectedSeq, actualSeq: entry.seq } },
      );
    }
    expectedSeq += 1;
  }
  const first = entries[0];
  if (first !== undefined && first.type !== 'workflow.started') {
    throw new Error2(
      WorkflowErrors.codes.WORKFLOW_JOURNAL_INVALID,
      `Workflow journal must begin with a workflow.started entry; found ${first.type}.`,
      { details: { firstType: first.type } },
    );
  }
  return entries;
}

export type WorkflowStepReplayStatus = 'running' | 'completed' | 'failed' | 'refused' | 'skipped';

export interface WorkflowStepReplayRecord {
  status: WorkflowStepReplayStatus;
  startedAt?: number;
  endedAt?: number;
  tokensUsed?: number;
  summary?: string;
  error?: string;
  refusedReason?: WorkflowRefusalReason;
  stalled?: boolean;
}

export interface WorkflowReplayState {
  workflowId?: string;
  fingerprint?: string;
  startedAt?: number;
  endedAt?: number;
  terminal?: 'completed' | 'failed';
  terminalReason?: string;
  steps: ReadonlyMap<string, WorkflowStepReplayRecord>;
}

export interface WorkflowCheckpoint {
  readonly seq: number;
  readonly state: WorkflowReplayState;
}

export function replayWorkflowJournal(entries: readonly WorkflowJournalEntry[]): WorkflowReplayState {
  const state: WorkflowReplayState & { steps: Map<string, WorkflowStepReplayRecord> } = {
    steps: new Map<string, WorkflowStepReplayRecord>(),
  };
  const stepRecord = (stepId: string): WorkflowStepReplayRecord => {
    const existing = state.steps.get(stepId);
    if (existing !== undefined) return existing;
    const created: WorkflowStepReplayRecord = { status: 'running' };
    state.steps.set(stepId, created);
    return created;
  };

  for (const entry of entries) {
    switch (entry.type) {
      case 'workflow.started': {
        state.workflowId = entry.workflowId;
        state.fingerprint = entry.fingerprint;
        state.startedAt = entry.at;
        state.terminal = undefined;
        state.terminalReason = undefined;
        break;
      }
      case 'workflow.resumed': {
        state.terminal = undefined;
        state.terminalReason = undefined;
        break;
      }
      case 'step.started': {
        const record = stepRecord(entry.stepId);
        record.status = 'running';
        record.startedAt = entry.at;
        record.endedAt = undefined;
        record.tokensUsed = undefined;
        record.summary = undefined;
        record.error = undefined;
        record.refusedReason = undefined;
        record.stalled = false;
        break;
      }
      case 'step.completed': {
        const record = stepRecord(entry.stepId);
        record.status = 'completed';
        record.endedAt = entry.at;
        record.tokensUsed = entry.tokensUsed;
        record.summary = entry.summary;
        record.error = undefined;
        break;
      }
      case 'step.failed': {
        const record = stepRecord(entry.stepId);
        record.status = 'failed';
        record.endedAt = entry.at;
        record.error = entry.error;
        break;
      }
      case 'step.refused': {
        const record = stepRecord(entry.stepId);
        record.status = 'refused';
        record.endedAt = entry.at;
        record.refusedReason = entry.reason;
        break;
      }
      case 'step.skipped': {
        const record = stepRecord(entry.stepId);
        record.status = 'skipped';
        record.endedAt = entry.at;
        break;
      }
      case 'step.stalled': {
        const record = stepRecord(entry.stepId);
        record.stalled = true;
        break;
      }
      case 'workflow.completed': {
        state.terminal = 'completed';
        state.endedAt = entry.at;
        state.terminalReason = undefined;
        break;
      }
      case 'workflow.failed': {
        state.terminal = 'failed';
        state.endedAt = entry.at;
        state.terminalReason = entry.reason;
        break;
      }
    }
  }
  return state;
}

export function collectStalledSteps(
  state: WorkflowReplayState,
  options: { readonly stallTimeoutMs: number; readonly now: number },
): string[] {
  if (!Number.isFinite(options.stallTimeoutMs) || options.stallTimeoutMs < 0) {
    throw new Error2(
      WorkflowErrors.codes.WORKFLOW_INVALID_OPTIONS,
      'stallTimeoutMs must be a finite non-negative number.',
      { details: { stallTimeoutMs: options.stallTimeoutMs } },
    );
  }
  const stalled: string[] = [];
  for (const [stepId, record] of state.steps) {
    if (record.status !== 'running') continue;
    if (record.startedAt === undefined) continue;
    if (options.now - record.startedAt < options.stallTimeoutMs) continue;
    stalled.push(stepId);
  }
  return stalled;
}

export class WorkflowJournal {
  private readonly entries: WorkflowJournalEntry[];

  constructor(options?: { readonly entries?: readonly WorkflowJournalEntry[] }) {
    this.entries = options?.entries === undefined ? [] : [...parseWorkflowJournalEntries(options.entries)];
  }

  get length(): number {
    return this.entries.length;
  }

  get nextSeq(): number {
    return this.entries.length + 1;
  }

  read(): readonly WorkflowJournalEntry[] {
    return this.entries;
  }

  append(entry: WorkflowJournalAppend, at: number): WorkflowJournalEntry {
    const seq = this.nextSeq;
    switch (entry.type) {
      case 'workflow.started':
        return this.push({ ...entry, seq, at });
      case 'workflow.resumed':
        return this.push({ ...entry, seq, at });
      case 'step.started':
        return this.push({ ...entry, seq, at });
      case 'step.completed':
        return this.push({ ...entry, seq, at });
      case 'step.failed':
        return this.push({ ...entry, seq, at });
      case 'step.refused':
        return this.push({ ...entry, seq, at });
      case 'step.skipped':
        return this.push({ ...entry, seq, at });
      case 'step.stalled':
        return this.push({ ...entry, seq, at });
      case 'workflow.completed':
        return this.push({ ...entry, seq, at });
      case 'workflow.failed':
        return this.push({ ...entry, seq, at });
    }
  }

  replay(): WorkflowReplayState {
    return replayWorkflowJournal(this.entries);
  }

  checkpoint(): WorkflowCheckpoint {
    return { seq: this.entries.length, state: this.replay() };
  }

  private push(entry: WorkflowJournalEntry): WorkflowJournalEntry {
    this.entries.push(entry);
    return entry;
  }
}
