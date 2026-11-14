import { Error2 } from '#/errors';
import type { SkillDefinition } from '#/features/skill/catalog/types';
import { normalizeSkillName } from '#/features/skill/catalog/types';

import { SkillCuratorErrors } from './errors';
import {
  collectStaleSkills,
  parseSkillLifecycleState,
  SkillLifecycleLedger,
  type SkillLifecycleEntry,
  type SkillLifecycleState,
  type StaleSkill,
} from './lifecycle';
import {
  assertCuratedSetName,
  buildCuratedSetLockfile,
  diffCuratedSet,
  parseCuratedSetLockfile,
  type CuratedSetDiff,
  type CuratedSetLockfile,
  type CuratedSetSkillRef,
} from './lockfile';
import { isCuratorStateInvalid, type SkillCuratorStore } from './store';
import {
  parseSkillUsageState,
  SkillUsageTracker,
  type SkillUsageEvent,
  type SkillUsageRef,
  type SkillUsageState,
  type SkillUsageTrigger,
} from './usage';

export const USAGE_STATE_KEY = 'usage.json';
export const LIFECYCLE_STATE_KEY = 'lifecycle.json';
export const SETS_PREFIX = 'sets';

export type CuratorRecordedSkill = Pick<SkillDefinition, 'name' | 'source' | 'path' | 'content'>;

export interface SkillCuratorOptions {
  readonly store: SkillCuratorStore;
  readonly now?: () => number;
}

export interface CuratedSetListing {
  readonly sets: readonly string[];
  readonly truncated: boolean;
}

/**
 * The skill curator tracks how skills are used and curates their lifecycle:
 * stale detection, archive/pin/restore, and reproducible curated-set
 * lockfiles. It is host-side infrastructure: nothing here is model-visible,
 * and nothing here changes what a skill is or how its content is trusted.
 *
 * Trust: curator documents never persist a trust label. A pinned or archived
 * skill keeps exactly the trust its `source` implies via `skillTrust`, and
 * lockfile entries store source/path/fingerprint only, so curator state can
 * never raise skill trust.
 *
 * Corruption policy: the two aggregate state files (usage, lifecycle) are
 * advisory and self-healing — a parse-invalid document is replaced with an
 * empty one on the next update rather than failing every future operation.
 * Named lockfiles are explicit user artifacts and fail loudly instead, as
 * does any document above the store's read cap.
 */
export class SkillCurator {
  private readonly now: () => number;

  constructor(private readonly options: SkillCuratorOptions) {
    this.now = options.now ?? Date.now;
  }

  async recordUsage(
    ref: SkillUsageRef,
    event: { readonly trigger: SkillUsageTrigger; readonly at?: number },
  ): Promise<SkillUsageEvent> {
    const at = event.at ?? this.now();
    return this.options.store.runExclusive(USAGE_STATE_KEY, async () => {
      const tracker = await this.loadUsageTracker();
      const recorded = tracker.record(ref, { trigger: event.trigger, at });
      await this.options.store.writeJson(USAGE_STATE_KEY, tracker.toJSON());
      return recorded;
    });
  }

  async usage(): Promise<SkillUsageState> {
    return (await this.loadUsageTracker()).toJSON();
  }

  async lifecycle(): Promise<SkillLifecycleState> {
    return (await this.loadLifecycleLedger()).toJSON();
  }

  async archive(name: string, options?: { readonly at?: number }): Promise<SkillLifecycleEntry> {
    const at = options?.at ?? this.now();
    return this.mutateLifecycle((ledger) => ledger.archive(name, at));
  }

  async restore(name: string, options?: { readonly at?: number }): Promise<SkillLifecycleEntry> {
    const at = options?.at ?? this.now();
    return this.mutateLifecycle((ledger) => ledger.restore(name, at));
  }

  async pin(name: string, options?: { readonly at?: number }): Promise<SkillLifecycleEntry> {
    const at = options?.at ?? this.now();
    return this.mutateLifecycle((ledger) => ledger.pin(name, at));
  }

  async unpin(name: string): Promise<SkillLifecycleEntry | undefined> {
    return this.mutateLifecycle((ledger) => ledger.unpin(name));
  }

  async staleSkills(options: {
    readonly staleAfterMs: number;
    readonly now?: number;
  }): Promise<readonly StaleSkill[]> {
    const [lifecycle, usage] = await Promise.all([
      this.loadLifecycleLedger(),
      this.loadUsageTracker(),
    ]);
    return collectStaleSkills({
      lifecycle: lifecycle.all(),
      usage: usage.all(),
      staleAfterMs: options.staleAfterMs,
      now: options.now ?? this.now(),
    });
  }

  /** Saving a set replaces its lockfile wholesale; that is the lockfile semantic. */
  async saveSet(
    name: string,
    skills: readonly CuratorRecordedSkill[],
    options?: { readonly at?: number },
  ): Promise<CuratedSetLockfile> {
    const canonical = this.canonicalSetName(name);
    const lockfile = buildCuratedSetLockfile(canonical, skills, options?.at ?? this.now());
    await this.options.store.writeJson(this.setKey(name), lockfile);
    return lockfile;
  }

  async loadSet(name: string): Promise<CuratedSetLockfile> {
    const canonical = this.canonicalSetName(name);
    const raw = await this.options.store.readJson(this.setKey(canonical));
    if (raw === undefined) {
      throw new Error2(
        SkillCuratorErrors.codes.SKILL_CURATOR_SET_NOT_FOUND,
        `Curated set "${canonical}" does not exist`,
        { details: { name: canonical } },
      );
    }
    return parseCuratedSetLockfile(raw);
  }

  async diffSet(name: string, skills: readonly CuratorRecordedSkill[]): Promise<CuratedSetDiff> {
    const lockfile = await this.loadSet(name);
    return diffCuratedSet(lockfile, skills);
  }

  async removeSet(name: string): Promise<void> {
    await this.loadSet(name);
    await this.options.store.deleteKey(this.setKey(name));
  }

  async listSets(): Promise<CuratedSetListing> {
    const listing = await this.options.store.listKeys(SETS_PREFIX);
    const sets = listing.keys.map((key) => key.slice(`${SETS_PREFIX}/`.length, -'.json'.length));
    return { sets, truncated: listing.truncated };
  }

  private canonicalSetName(name: string): string {
    return assertCuratedSetName(normalizeSkillName(name));
  }

  private setKey(name: string): string {
    return `${SETS_PREFIX}/${this.canonicalSetName(name)}.json`;
  }

  private async mutateLifecycle<T>(
    mutate: (ledger: SkillLifecycleLedger) => T,
  ): Promise<T> {
    return this.options.store.runExclusive(LIFECYCLE_STATE_KEY, async () => {
      const ledger = await this.loadLifecycleLedger();
      const result = mutate(ledger);
      await this.options.store.writeJson(LIFECYCLE_STATE_KEY, ledger.toJSON());
      return result;
    });
  }

  private async loadUsageTracker(): Promise<SkillUsageTracker> {
    const raw = await this.readAdvisoryState(USAGE_STATE_KEY);
    return raw === undefined ? new SkillUsageTracker() : new SkillUsageTracker(parseSkillUsageState(raw));
  }

  private async loadLifecycleLedger(): Promise<SkillLifecycleLedger> {
    const raw = await this.readAdvisoryState(LIFECYCLE_STATE_KEY);
    return raw === undefined
      ? new SkillLifecycleLedger()
      : new SkillLifecycleLedger(parseSkillLifecycleState(raw));
  }

  private async readAdvisoryState(key: string): Promise<unknown | undefined> {
    try {
      return await this.options.store.readJson(key);
    } catch (error) {
      // Only parse-invalid documents self-heal; a document above the read cap
      // is an anomaly the caller must see.
      if (isCuratorStateInvalid(error)) return undefined;
      throw error;
    }
  }
}
