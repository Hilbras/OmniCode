import { z } from 'zod';

import { Error2 } from '#/errors';
import { normalizeSkillName } from '#/features/skill/catalog/types';

import { SkillCuratorErrors } from './errors';
import type { SkillUsageRecord } from './usage';

export type SkillLifecycleStatus = 'active' | 'archived';

export interface SkillLifecycleEntry {
  readonly name: string;
  readonly status: SkillLifecycleStatus;
  readonly pinned: boolean;
  readonly archivedAt?: number;
  readonly restoredAt?: number;
  readonly pinnedAt?: number;
}

export interface SkillLifecycleState {
  readonly version: 1;
  readonly skills: Readonly<Record<string, SkillLifecycleEntry>>;
}

const atSchema = z.number().int().finite().nonnegative();

const lifecycleEntrySchema = z.object({
  name: z.string().min(1),
  status: z.enum(['active', 'archived']),
  pinned: z.boolean(),
  archivedAt: atSchema.optional(),
  restoredAt: atSchema.optional(),
  pinnedAt: atSchema.optional(),
});

const lifecycleStateSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), lifecycleEntrySchema),
});

export function parseSkillLifecycleState(input: unknown): SkillLifecycleState {
  const parsed = lifecycleStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
      `Invalid skill lifecycle state: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
  return parsed.data;
}

export class SkillLifecycleLedger {
  private readonly skills = new Map<string, SkillLifecycleEntry>();

  constructor(state?: SkillLifecycleState) {
    if (state === undefined) return;
    for (const [key, entry] of Object.entries(state.skills)) {
      this.skills.set(key, entry);
    }
  }

  /**
   * Absent entries mean active and unpinned: the ledger only stores what a
   * curator action or a persisted file actually said, never a default
   * invented on its behalf.
   */
  entryFor(name: string): SkillLifecycleEntry | undefined {
    return this.skills.get(normalizeSkillName(name));
  }

  all(): readonly SkillLifecycleEntry[] {
    return [...this.skills.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  archive(name: string, at: number): SkillLifecycleEntry {
    const atValid = positiveInteger(at, 'archivedAt');
    const key = normalizeSkillName(name);
    const existing = this.skills.get(key);
    if (existing !== undefined && existing.status === 'archived') return existing;
    const entry: SkillLifecycleEntry = {
      name: existing?.name ?? name,
      status: 'archived',
      pinned: existing?.pinned ?? false,
      archivedAt: atValid,
      pinnedAt: existing?.pinnedAt,
    };
    this.skills.set(key, entry);
    return entry;
  }

  /** Restoring a skill that was never archived is a no-op, not a stamp. */
  restore(name: string, at: number): SkillLifecycleEntry {
    const atValid = positiveInteger(at, 'restoredAt');
    const key = normalizeSkillName(name);
    const existing = this.skills.get(key);
    if (existing === undefined || existing.status === 'active') {
      return existing ?? { name, status: 'active', pinned: false };
    }
    const entry: SkillLifecycleEntry = {
      name: existing.name,
      status: 'active',
      pinned: existing.pinned,
      restoredAt: atValid,
    };
    this.skills.set(key, entry);
    return entry;
  }

  pin(name: string, at: number): SkillLifecycleEntry {
    const atValid = positiveInteger(at, 'pinnedAt');
    const key = normalizeSkillName(name);
    const existing = this.skills.get(key);
    if (existing !== undefined && existing.pinned) return existing;
    const entry: SkillLifecycleEntry = {
      name: existing?.name ?? name,
      status: existing?.status ?? 'active',
      pinned: true,
      archivedAt: existing?.archivedAt,
      restoredAt: existing?.restoredAt,
      pinnedAt: atValid,
    };
    this.skills.set(key, entry);
    return entry;
  }

  unpin(name: string): SkillLifecycleEntry | undefined {
    const key = normalizeSkillName(name);
    const existing = this.skills.get(key);
    if (existing === undefined) return undefined;
    if (!existing.pinned) return existing;
    const entry: SkillLifecycleEntry = {
      name: existing.name,
      status: existing.status,
      pinned: false,
      archivedAt: existing.archivedAt,
      restoredAt: existing.restoredAt,
    };
    this.skills.set(key, entry);
    return entry;
  }

  toJSON(): SkillLifecycleState {
    return {
      version: 1,
      skills: Object.fromEntries(
        [...this.skills.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    };
  }
}

export interface StaleSkill {
  readonly name: string;
  readonly lastUsedAt: number;
  readonly ageMs: number;
}

/**
 * A skill is stale when it was actually observed in use, has gone unused for
 * `staleAfterMs`, is not pinned, and is not archived. Skills without usage
 * data are never declared stale: staleness is an honest reading of recorded
 * usage, not a guess about skills the curator never saw.
 */
export function collectStaleSkills(options: {
  readonly lifecycle: readonly SkillLifecycleEntry[];
  readonly usage: readonly SkillUsageRecord[];
  readonly staleAfterMs: number;
  readonly now: number;
}): readonly StaleSkill[] {
  const { staleAfterMs, now } = options;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_OPTIONS_INVALID,
      `staleAfterMs must be a finite positive number, got ${String(staleAfterMs)}`,
      { details: { staleAfterMs } },
    );
  }
  if (!Number.isFinite(now) || now < 0) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_OPTIONS_INVALID,
      `now must be a finite non-negative number, got ${String(now)}`,
      { details: { now } },
    );
  }
  const byName = new Map(options.lifecycle.map((entry) => [normalizeSkillName(entry.name), entry]));
  const stale: StaleSkill[] = [];
  for (const record of options.usage) {
    if (record.count <= 0) continue;
    const entry = byName.get(normalizeSkillName(record.name));
    if (entry !== undefined && (entry.pinned || entry.status === 'archived')) continue;
    const ageMs = now - record.lastUsedAt;
    if (ageMs < staleAfterMs) continue;
    stale.push({ name: record.name, lastUsedAt: record.lastUsedAt, ageMs });
  }
  return stale.toSorted((a, b) => a.lastUsedAt - b.lastUsedAt);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_OPTIONS_INVALID,
      `Skill lifecycle ${field} must be a non-negative integer, got ${String(value)}`,
    );
  }
  return value;
}
