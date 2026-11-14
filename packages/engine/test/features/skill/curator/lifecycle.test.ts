import { describe, expect, it } from 'vitest';

import {
  SkillLifecycleLedger,
  collectStaleSkills,
  parseSkillLifecycleState,
  type SkillLifecycleEntry,
} from '#/features/skill/curator/lifecycle';
import { SkillUsageTracker, type SkillUsageRecord } from '#/features/skill/curator/usage';

function usageRecord(name: string, lastUsedAt: number): SkillUsageRecord {
  return {
    name,
    count: 1,
    firstUsedAt: lastUsedAt,
    lastUsedAt,
    lastTrigger: 'user-slash',
    lastSource: 'user',
    lastPath: `/skills/${name}/SKILL.md`,
  };
}

function entry(partial: Partial<SkillLifecycleEntry> & { readonly name: string }): SkillLifecycleEntry {
  return { status: 'active', pinned: false, ...partial };
}

describe('SkillLifecycleLedger', () => {
  it('absent entries mean active and unpinned', () => {
    const ledger = new SkillLifecycleLedger();
    expect(ledger.entryFor('anything')).toBeUndefined();
    expect(ledger.all()).toEqual([]);
  });

  it('archives, restores, pins, and unpins with explicit timestamps', () => {
    const ledger = new SkillLifecycleLedger();
    expect(ledger.archive('deploy', 10)).toMatchObject({ name: 'deploy', status: 'archived', archivedAt: 10 });
    expect(ledger.restore('deploy', 20)).toEqual({
      name: 'deploy',
      status: 'active',
      pinned: false,
      restoredAt: 20,
    });
    expect(ledger.entryFor('deploy')?.archivedAt).toBeUndefined();
    expect(ledger.pin('deploy', 30)).toMatchObject({ name: 'deploy', pinned: true, pinnedAt: 30 });
    expect(ledger.unpin('deploy')).toEqual({
      name: 'deploy',
      status: 'active',
      pinned: false,
      restoredAt: 20,
    });
  });

  it('archive is idempotent and keeps the first archivedAt', () => {
    const ledger = new SkillLifecycleLedger();
    ledger.archive('deploy', 10);
    expect(ledger.archive('deploy', 99)).toMatchObject({ status: 'archived', archivedAt: 10 });
  });

  it('restoring a skill that was never archived is a no-op without a stamp', () => {
    const ledger = new SkillLifecycleLedger();
    expect(ledger.restore('deploy', 10)).toEqual({ name: 'deploy', status: 'active', pinned: false });
    expect(ledger.entryFor('deploy')).toBeUndefined();
  });

  it('pin survives an archive round-trip and is idempotent', () => {
    const ledger = new SkillLifecycleLedger();
    ledger.pin('deploy', 5);
    expect(ledger.archive('deploy', 6)).toMatchObject({ status: 'archived', pinned: true, pinnedAt: 5 });
    expect(ledger.pin('deploy', 7)).toMatchObject({ pinnedAt: 5 });
  });

  it('unpin of an unknown skill is undefined and stores nothing', () => {
    const ledger = new SkillLifecycleLedger();
    expect(ledger.unpin('ghost')).toBeUndefined();
    expect(ledger.entryFor('ghost')).toBeUndefined();
  });

  it('round-trips through its persisted state', () => {
    const ledger = new SkillLifecycleLedger();
    ledger.archive('a', 1);
    ledger.pin('b', 2);
    ledger.archive('c', 3);
    ledger.restore('c', 4);
    const restored = new SkillLifecycleLedger(parseSkillLifecycleState(ledger.toJSON()));
    expect(restored.all()).toEqual(ledger.all());
    expect(restored.toJSON()).toEqual(ledger.toJSON());
  });

  it('rejects malformed persisted state', () => {
    expect(() => parseSkillLifecycleState({ version: 1, skills: { a: { name: 'a' } } })).toThrow();
    expect(() =>
      parseSkillLifecycleState({
        version: 1,
        skills: { a: { name: 'a', status: 'deleted', pinned: false } },
      }),
    ).toThrow();
  });
});

describe('collectStaleSkills', () => {
  it('declares only observed skills beyond the staleness window stale', () => {
    const stale = collectStaleSkills({
      lifecycle: [],
      usage: [usageRecord('old', 0), usageRecord('fresh', 90)],
      staleAfterMs: 100,
      now: 150,
    });
    expect(stale).toEqual([{ name: 'old', lastUsedAt: 0, ageMs: 150 }]);
  });

  it('never declares skills without usage data stale', () => {
    const ledger = new SkillLifecycleLedger();
    ledger.archive('never-used', 5);
    const stale = collectStaleSkills({
      lifecycle: ledger.all(),
      usage: [],
      staleAfterMs: 1,
      now: 1_000_000,
    });
    expect(stale).toEqual([]);
  });

  it('exempts pinned skills from staleness', () => {
    const stale = collectStaleSkills({
      lifecycle: [entry({ name: 'pinned', pinned: true, pinnedAt: 1 })],
      usage: [usageRecord('pinned', 0)],
      staleAfterMs: 10,
      now: 1000,
    });
    expect(stale).toEqual([]);
  });

  it('excludes archived skills: they are already out of circulation', () => {
    const stale = collectStaleSkills({
      lifecycle: [entry({ name: 'archived', status: 'archived', archivedAt: 1 })],
      usage: [usageRecord('archived', 0)],
      staleAfterMs: 10,
      now: 1000,
    });
    expect(stale).toEqual([]);
  });

  it('orders stale skills stalest-first', () => {
    const stale = collectStaleSkills({
      lifecycle: [],
      usage: [usageRecord('a', 500), usageRecord('b', 100), usageRecord('c', 900)],
      staleAfterMs: 10,
      now: 2000,
    });
    expect(stale.map((skill) => skill.name)).toEqual(['b', 'a', 'c']);
  });

  it('rejects invalid staleness options', () => {
    expect(() =>
      collectStaleSkills({ lifecycle: [], usage: [], staleAfterMs: 0, now: 1 }),
    ).toThrow();
    expect(() =>
      collectStaleSkills({ lifecycle: [], usage: [], staleAfterMs: 10, now: -1 }),
    ).toThrow();
  });
});

describe('usage feeds staleness through the curator primitives', () => {
  it('a tracker aggregate drives collectStaleSkills', () => {
    const tracker = new SkillUsageTracker();
    tracker.record({ name: 'deploy', source: 'project', path: '/p' }, { trigger: 'user-slash', at: 0 });
    tracker.record({ name: 'deploy', source: 'project', path: '/p' }, { trigger: 'model-tool', at: 1500 });
    const stale = collectStaleSkills({
      lifecycle: [],
      usage: tracker.all(),
      staleAfterMs: 1000,
      now: 2600,
    });
    expect(stale).toEqual([{ name: 'deploy', lastUsedAt: 1500, ageMs: 1100 }]);
  });
});
