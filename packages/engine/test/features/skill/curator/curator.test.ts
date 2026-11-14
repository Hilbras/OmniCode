import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NodeCuratorStore,
  SkillCurator,
  SkillCuratorErrors,
} from '#/features/skill/curator/index';
import type { SkillUsageTrigger } from '#/features/skill/curator/usage';

function thrownCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function ref(name: string, source: 'project' | 'user' | 'extra' | 'builtin' = 'user') {
  return { name, source, path: `/skills/${name}/SKILL.md`, content: `# ${name}` };
}

async function mkdtempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-curator-'));
}

describe('NodeCuratorStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtempRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function store(options?: { readonly maxFileBytes?: number; readonly maxListedKeys?: number }) {
    return new NodeCuratorStore({ rootDir: root, ...options });
  }

  it('round-trips JSON documents and reports missing files as undefined', async () => {
    const s = store();
    await expect(s.readJson('usage.json')).resolves.toBeUndefined();
    await s.writeJson('usage.json', { version: 1, hello: 'world' });
    await expect(s.readJson('usage.json')).resolves.toEqual({ version: 1, hello: 'world' });
  });

  it('keeps keys inside the store root', async () => {
    const s = store();
    await expect(s.readJson('../escape.json')).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
    });
    await expect(s.readJson('/abs/path.json')).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
    });
    await expect(s.readJson('sets/.hidden.json')).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
    });
    await expect(s.writeJson('a/b/c.json', {})).resolves.toBeUndefined();
    await expect(s.readJson('a/b/c.json')).resolves.toEqual({});
  });

  it('fails loudly on invalid JSON instead of guessing', async () => {
    const s = store();
    await mkdir(join(root, 'sets'), { recursive: true });
    await writeFile(join(root, 'sets', 'broken.json'), '{not json', 'utf8');
    await expect(s.readJson('sets/broken.json')).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
    });
  });

  it('refuses reads and writes above the byte cap', async () => {
    const s = store({ maxFileBytes: 16 });
    await expect(s.writeJson('too-big.json', { padding: 'x'.repeat(64) })).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
    });
    await writeFile(join(root, 'planted.json'), JSON.stringify({ padding: 'x'.repeat(64) }), 'utf8');
    await expect(s.readJson('planted.json')).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
    });
  });

  it('deletes idempotently', async () => {
    const s = store();
    await s.writeJson('gone.json', 1);
    await s.deleteKey('gone.json');
    await expect(s.deleteKey('gone.json')).resolves.toBeUndefined();
    await expect(s.readJson('gone.json')).resolves.toBeUndefined();
  });

  it('lists keys bounded, filters non-JSON, and reports truncation honestly', async () => {
    const s = store({ maxListedKeys: 2 });
    for (const name of ['a', 'b', 'c']) {
      await s.writeJson(`sets/${name}.json`, { name });
    }
    await s.writeJson('sets/scratch.txt', {});
    const listing = await s.listKeys('sets');
    expect(listing.keys).toEqual(['sets/a.json', 'sets/b.json']);
    expect(listing.truncated).toBe(true);
    const unbounded = await new NodeCuratorStore({ rootDir: root }).listKeys('sets');
    expect(unbounded.keys).toEqual(['sets/a.json', 'sets/b.json', 'sets/c.json']);
    expect(unbounded.truncated).toBe(false);
  });

  it('serializes operations on the same key: the second waits for the first', async () => {
    const s = store();
    const events: string[] = [];
    let releaseStarted!: () => void;
    let releaseFinished!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      releaseStarted = resolveStarted;
    });
    const finished = new Promise<void>((resolveFinished) => {
      releaseFinished = resolveFinished;
    });
    const first = s.runExclusive('usage.json', async () => {
      events.push('first-start');
      releaseStarted();
      await finished;
      events.push('first-end');
    });
    const second = s.runExclusive('usage.json', async () => {
      events.push('second-start');
    });
    await started;
    expect(events).toEqual(['first-start']);
    releaseFinished();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('lets operations on different keys run concurrently', async () => {
    const s = store();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const first = s.runExclusive('a.json', () => gate);
    const second = s.runExclusive('b.json', async () => 'done');
    await expect(second).resolves.toBe('done');
    release();
    await first;
  });

  it('still resolves later operations when one fails', async () => {
    const s = store();
    const failing = s.runExclusive('usage.json', async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(s.runExclusive('usage.json', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('rejects invalid store options', () => {
    expect(() => store({ maxFileBytes: 0 })).toThrow();
    expect(() => store({ maxListedKeys: -1 })).toThrow();
  });
});

describe('SkillCurator usage tracking', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtempRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('records usage and persists it across curator instances', async () => {
    const first = new SkillCurator({ store: new NodeCuratorStore({ rootDir: root }), now: () => 0 });
    const event = await first.recordUsage(ref('deploy', 'project'), { trigger: 'user-slash', at: 100 });
    expect(event).toMatchObject({
      skillName: 'deploy',
      trigger: 'user-slash',
      at: 100,
      source: 'project',
      path: '/skills/deploy/SKILL.md',
    });
    await first.recordUsage(ref('deploy', 'project'), { trigger: 'model-tool', at: 250 });

    const second = new SkillCurator({ store: new NodeCuratorStore({ rootDir: root }), now: () => 0 });
    const usage = await second.usage();
    expect(usage.version).toBe(1);
    expect(usage.skills['deploy']).toMatchObject({
      name: 'deploy',
      count: 2,
      firstUsedAt: 100,
      lastUsedAt: 250,
      lastTrigger: 'model-tool',
      lastSource: 'project',
    });
  });

  it('does not lose concurrent activations: read-modify-write cycles serialize per file', async () => {
    const c = new SkillCurator({ store: new NodeCuratorStore({ rootDir: root }), now: () => 0 });
    const triggers: SkillUsageTrigger[] = ['user-slash', 'model-tool', 'nested-skill'];
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        c.recordUsage(ref(`skill-${String(index)}`), {
          trigger: triggers[index % triggers.length] ?? 'user-slash',
          at: index,
        }),
      ),
    );
    const usage = await c.usage();
    expect(Object.keys(usage.skills)).toHaveLength(12);
    expect(usage.recent).toHaveLength(12);
    expect(usage.droppedEvents).toBe(0);
    expect(usage.skills['skill-0']).toMatchObject({ count: 1 });
    expect(usage.skills['skill-11']).toMatchObject({ count: 1 });
  });

  it('self-heals parse-invalid advisory state instead of failing forever', async () => {
    await writeFile(join(root, 'usage.json'), '{corrupted', 'utf8');
    const c = new SkillCurator({ store: new NodeCuratorStore({ rootDir: root }), now: () => 0 });
    await expect(c.usage()).resolves.toMatchObject({ version: 1, skills: {}, recent: [] });
    await c.recordUsage(ref('deploy'), { trigger: 'user-slash', at: 1 });
    const usage = await c.usage();
    expect(usage.skills['deploy']?.count).toBe(1);
  });

  it('surfaces oversized advisory state instead of silently replacing it', async () => {
    await writeFile(
      join(root, 'usage.json'),
      JSON.stringify({ padding: 'x'.repeat(200) }),
      'utf8',
    );
    const c = new SkillCurator({
      store: new NodeCuratorStore({ rootDir: root, maxFileBytes: 64 }),
      now: () => 0,
    });
    expect(thrownCode(await c.usage().catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
    );
    expect(
      thrownCode(await c.recordUsage(ref('deploy'), { trigger: 'user-slash' }).catch((error) => error)),
    ).toBe(SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE);
    await expect(c.usage()).rejects.toMatchObject({
      code: SkillCuratorErrors.codes.SKILL_CURATOR_STATE_TOO_LARGE,
    });
  });
});

describe('SkillCurator lifecycle', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtempRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function curator(): SkillCurator {
    return new SkillCurator({ store: new NodeCuratorStore({ rootDir: root }), now: () => 500 });
  }

  it('archives, pins, and restores with persistence across instances', async () => {
    const first = curator();
    await first.recordUsage(ref('deploy'), { trigger: 'user-slash', at: 10 });
    expect(await first.archive('deploy')).toMatchObject({
      name: 'deploy',
      status: 'archived',
      archivedAt: 500,
    });
    expect(await first.pin('deploy')).toMatchObject({ name: 'deploy', pinned: true, pinnedAt: 500 });

    const second = curator();
    const lifecycle = await second.lifecycle();
    expect(lifecycle.skills['deploy']).toMatchObject({ status: 'archived', pinned: true });

    expect(await second.restore('deploy')).toMatchObject({ status: 'active', restoredAt: 500 });
    expect(await second.unpin('deploy')).toMatchObject({ pinned: false });
    expect(await second.lifecycle()).toMatchObject({
      version: 1,
      skills: { deploy: { status: 'active', pinned: false } },
    });
  });

  it('unpin of an unknown skill reports undefined', async () => {
    expect(await curator().unpin('ghost')).toBeUndefined();
  });

  it('reports stale skills from recorded usage and exempts pinned and archived ones', async () => {
    const c = curator();
    await c.recordUsage(ref('stale-one'), { trigger: 'user-slash', at: 0 });
    await c.recordUsage(ref('stale-two'), { trigger: 'user-slash', at: 400 });
    await c.recordUsage(ref('pinned'), { trigger: 'user-slash', at: 0 });
    await c.recordUsage(ref('archived'), { trigger: 'user-slash', at: 0 });
    await c.pin('pinned');
    await c.archive('archived');

    const stale = await c.staleSkills({ staleAfterMs: 100, now: 1000 });
    expect(stale.map((skill) => skill.name)).toEqual(['stale-one', 'stale-two']);
    expect(stale[0]).toMatchObject({ lastUsedAt: 0, ageMs: 1000 });
  });
});

describe('SkillCurator curated sets', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtempRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function curator(): SkillCurator {
    return new SkillCurator({ store: new NodeCuratorStore({ rootDir: root }), now: () => 42 });
  }

  it('saves, loads, diffs, lists, and removes a curated set', async () => {
    const c = curator();
    const saved = await c.saveSet('frontend', [ref('css'), ref('html', 'project')]);
    expect(saved).toMatchObject({ version: 1, name: 'frontend', createdAt: 42 });

    const loaded = await c.loadSet('Frontend');
    expect(loaded).toEqual(saved);
    expect(loaded.entries['html']?.source).toBe('project');

    await expect(c.diffSet('frontend', [ref('css'), ref('html', 'project')])).resolves.toEqual({
      missing: [],
      changed: [],
      extra: [],
    });
    await expect(c.diffSet('frontend', [ref('css')])).resolves.toEqual({
      missing: ['html'],
      changed: [],
      extra: [],
    });

    await expect(c.listSets()).resolves.toEqual({ sets: ['frontend'], truncated: false });
    await c.removeSet('frontend');
    await expect(c.listSets()).resolves.toEqual({ sets: [], truncated: false });
  });

  it('saving a set again replaces its lockfile wholesale', async () => {
    const c = curator();
    await c.saveSet('pack', [ref('one'), ref('two')]);
    await c.saveSet('pack', [ref('three')]);
    const loaded = await c.loadSet('pack');
    expect(Object.keys(loaded.entries)).toEqual(['three']);
  });

  it('rejects traversal and malformed set names', async () => {
    const c = curator();
    expect(thrownCode(await c.saveSet('../evil', []).catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_SET_NAME_INVALID,
    );
    expect(thrownCode(await c.loadSet('a/b').catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_SET_NAME_INVALID,
    );
    expect(thrownCode(await c.loadSet('.hidden').catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_SET_NAME_INVALID,
    );
  });

  it('fails loudly on missing and corrupt lockfiles', async () => {
    const c = curator();
    expect(thrownCode(await c.loadSet('absent').catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_SET_NOT_FOUND,
    );
    expect(thrownCode(await c.removeSet('absent').catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_SET_NOT_FOUND,
    );
    await mkdir(join(root, 'sets'), { recursive: true });
    await writeFile(join(root, 'sets', 'broken.json'), 'nope', 'utf8');
    expect(thrownCode(await c.loadSet('broken').catch((error) => error))).toBe(
      SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
    );
  });

  it('caps the listed sets and reports truncation', async () => {
    const c = new SkillCurator({
      store: new NodeCuratorStore({ rootDir: root, maxListedKeys: 2 }),
      now: () => 0,
    });
    for (const name of ['set-a', 'set-b', 'set-c']) {
      await c.saveSet(name, []);
    }
    const listing = await c.listSets();
    expect(listing.sets).toEqual(['set-a', 'set-b']);
    expect(listing.truncated).toBe(true);
  });

  it('a lockfile-recorded project skill stays untrusted on reload', async () => {
    const c = curator();
    await c.saveSet('pack', [ref('proj', 'project')]);
    const loaded = await c.loadSet('pack');
    expect(loaded.entries['proj']?.source).toBe('project');
    expect(JSON.stringify(loaded)).not.toContain('trust');
  });
});
