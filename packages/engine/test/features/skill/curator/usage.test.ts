import { describe, expect, it } from 'vitest';

import {
  MAX_TRACKED_SKILLS,
  MAX_USAGE_EVENTS,
  SkillUsageTracker,
  parseSkillUsageState,
} from '#/features/skill/curator/usage';

function ref(name: string, source: 'project' | 'user' | 'extra' | 'builtin' = 'user') {
  return { name, source, path: `/skills/${name}/SKILL.md` };
}

describe('SkillUsageTracker', () => {
  it('aggregates activations per skill', () => {
    const tracker = new SkillUsageTracker();
    tracker.record(ref('deploy'), { trigger: 'user-slash', at: 10 });
    tracker.record(ref('deploy'), { trigger: 'model-tool', at: 25 });
    const record = tracker.usageFor('deploy');
    expect(record).toMatchObject({
      name: 'deploy',
      count: 2,
      firstUsedAt: 10,
      lastUsedAt: 25,
      lastTrigger: 'model-tool',
      lastSource: 'user',
    });
  });

  it('keys lookups case-insensitively like the catalog', () => {
    const tracker = new SkillUsageTracker();
    tracker.record(ref('Deploy'), { trigger: 'user-slash', at: 1 });
    expect(tracker.usageFor('deploy')?.count).toBe(1);
    expect(tracker.usageFor('DEPLOY')?.count).toBe(1);
  });

  it('keeps a bounded recent-event window and counts what it drops', () => {
    const tracker = new SkillUsageTracker();
    for (let index = 0; index < MAX_USAGE_EVENTS + 7; index++) {
      tracker.record(ref(`skill-${String(index)}`), { trigger: 'user-slash', at: index });
    }
    const recent = tracker.recentEvents();
    expect(recent).toHaveLength(MAX_USAGE_EVENTS);
    expect(recent[0]?.skillName).toBe(`skill-7`);
    expect(recent.at(-1)?.skillName).toBe(`skill-${String(MAX_USAGE_EVENTS + 6)}`);
    expect(tracker.counters().droppedEvents).toBe(7);
  });

  it('evicts the least-recently-used skill beyond the tracked cap and counts it', () => {
    const tracker = new SkillUsageTracker();
    for (let index = 0; index < MAX_TRACKED_SKILLS; index++) {
      tracker.record(ref(`s-${String(index)}`), { trigger: 'user-slash', at: index });
    }
    tracker.record(ref('overflow'), { trigger: 'user-slash', at: MAX_TRACKED_SKILLS });
    expect(tracker.all()).toHaveLength(MAX_TRACKED_SKILLS);
    expect(tracker.usageFor('s-0')).toBeUndefined();
    expect(tracker.usageFor('overflow')?.count).toBe(1);
    expect(tracker.counters().droppedSkills).toBe(1);
  });

  it('round-trips through its persisted state', () => {
    const tracker = new SkillUsageTracker();
    tracker.record(ref('proj', 'project'), { trigger: 'user-slash', at: 3 });
    tracker.record(ref('builtin', 'builtin'), { trigger: 'nested-skill', at: 9 });
    const restored = new SkillUsageTracker(parseSkillUsageState(tracker.toJSON()));
    expect(restored.usageFor('proj')).toEqual(tracker.usageFor('proj'));
    expect(restored.recentEvents()).toEqual(tracker.recentEvents());
    expect(restored.toJSON()).toEqual(tracker.toJSON());
  });

  it('rejects malformed persisted state instead of half-loading it', () => {
    expect(() => parseSkillUsageState({ version: 1 })).toThrow();
    expect(() =>
      parseSkillUsageState({
        version: 1,
        skills: { deploy: { name: 'deploy', count: -1 } },
        recent: [],
        droppedEvents: 0,
        droppedSkills: 0,
      }),
    ).toThrow();
  });

  it('rejects non-integer activation timestamps', () => {
    const tracker = new SkillUsageTracker();
    expect(() => tracker.record(ref('deploy'), { trigger: 'user-slash', at: 1.5 })).toThrow();
  });
});
