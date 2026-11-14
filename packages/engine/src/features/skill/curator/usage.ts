import { z } from 'zod';

import { Error2 } from '#/errors';
import { normalizeSkillName } from '#/features/skill/catalog/types';
import type { SkillSource } from '#/features/skill/catalog/types';

import { SkillCuratorErrors } from './errors';

export const MAX_USAGE_EVENTS = 256;
export const MAX_TRACKED_SKILLS = 512;

export type SkillUsageTrigger = 'user-slash' | 'model-tool' | 'nested-skill';

const triggerSchema = z.enum(['user-slash', 'model-tool', 'nested-skill']);
const sourceSchema = z.enum(['project', 'user', 'extra', 'builtin']);
const atSchema = z.number().int().finite().nonnegative();

export interface SkillUsageEvent {
  readonly skillName: string;
  readonly trigger: SkillUsageTrigger;
  readonly at: number;
  readonly source: SkillSource;
  readonly path: string;
}

export interface SkillUsageRecord {
  readonly name: string;
  readonly count: number;
  readonly firstUsedAt: number;
  readonly lastUsedAt: number;
  readonly lastTrigger: SkillUsageTrigger;
  readonly lastSource: SkillSource;
  readonly lastPath: string;
}

export interface SkillUsageState {
  readonly version: 1;
  readonly skills: Readonly<Record<string, SkillUsageRecord>>;
  readonly recent: readonly SkillUsageEvent[];
  readonly droppedEvents: number;
  readonly droppedSkills: number;
}

export interface SkillUsageRef {
  readonly name: string;
  readonly source: SkillSource;
  readonly path: string;
}

const usageEventSchema = z.object({
  skillName: z.string().min(1),
  trigger: triggerSchema,
  at: atSchema,
  source: sourceSchema,
  path: z.string().min(1),
});

const usageRecordSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().finite().nonnegative(),
  firstUsedAt: atSchema,
  lastUsedAt: atSchema,
  lastTrigger: triggerSchema,
  lastSource: sourceSchema,
  lastPath: z.string().min(1),
});

const usageStateSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), usageRecordSchema),
  recent: z.array(usageEventSchema),
  droppedEvents: z.number().int().finite().nonnegative(),
  droppedSkills: z.number().int().finite().nonnegative(),
});

export function parseSkillUsageState(input: unknown): SkillUsageState {
  const parsed = usageStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
      `Invalid skill usage state: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
  return parsed.data;
}

export class SkillUsageTracker {
  private readonly skills = new Map<string, SkillUsageRecord>();
  private readonly recent: SkillUsageEvent[] = [];
  private droppedEvents = 0;
  private droppedSkills = 0;

  constructor(state?: SkillUsageState) {
    if (state === undefined) return;
    for (const [key, record] of Object.entries(state.skills)) {
      this.skills.set(key, record);
    }
    this.recent.push(...state.recent);
    this.droppedEvents = state.droppedEvents;
    this.droppedSkills = state.droppedSkills;
  }

  record(ref: SkillUsageRef, event: { readonly trigger: SkillUsageTrigger; readonly at: number }): SkillUsageEvent {
    const at = positiveInteger(event.at, 'at');
    const recordEvent: SkillUsageEvent = {
      skillName: ref.name,
      trigger: event.trigger,
      at,
      source: ref.source,
      path: ref.path,
    };
    if (this.recent.length >= MAX_USAGE_EVENTS) {
      this.recent.shift();
      this.droppedEvents += 1;
    }
    this.recent.push(recordEvent);

    const key = normalizeSkillName(ref.name);
    const existing = this.skills.get(key);
    if (existing === undefined) {
      if (this.skills.size >= MAX_TRACKED_SKILLS) {
        this.evictOldest();
      }
      this.skills.set(key, {
        name: ref.name,
        count: 1,
        firstUsedAt: at,
        lastUsedAt: at,
        lastTrigger: event.trigger,
        lastSource: ref.source,
        lastPath: ref.path,
      });
      return recordEvent;
    }
    this.skills.set(key, {
      ...existing,
      count: existing.count + 1,
      lastUsedAt: at,
      lastTrigger: event.trigger,
      lastSource: ref.source,
      lastPath: ref.path,
    });
    return recordEvent;
  }

  usageFor(name: string): SkillUsageRecord | undefined {
    return this.skills.get(normalizeSkillName(name));
  }

  all(): readonly SkillUsageRecord[] {
    return [...this.skills.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  recentEvents(): readonly SkillUsageEvent[] {
    return [...this.recent];
  }

  counters(): { readonly droppedEvents: number; readonly droppedSkills: number } {
    return { droppedEvents: this.droppedEvents, droppedSkills: this.droppedSkills };
  }

  toJSON(): SkillUsageState {
    return {
      version: 1,
      skills: Object.fromEntries([...this.skills.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      recent: [...this.recent],
      droppedEvents: this.droppedEvents,
      droppedSkills: this.droppedSkills,
    };
  }

  private evictOldest(): void {
    let oldest: { readonly key: string; readonly lastUsedAt: number } | undefined;
    for (const [key, record] of this.skills) {
      if (oldest === undefined || record.lastUsedAt < oldest.lastUsedAt) {
        oldest = { key, lastUsedAt: record.lastUsedAt };
      }
    }
    if (oldest === undefined) return;
    this.skills.delete(oldest.key);
    this.droppedSkills += 1;
  }
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_USAGE_INVALID,
      `Skill usage ${field} must be a non-negative integer, got ${String(value)}`,
    );
  }
  return value;
}
