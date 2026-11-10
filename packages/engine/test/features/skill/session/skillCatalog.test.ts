import { beforeEach, describe, expect, it } from 'vitest';

import { _clearScopedRegistryForTests, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { createScopedTestHost, stubPair } from '@hilbras/omnicode-base/di/test';
import { Emitter } from '@hilbras/omnicode-base/event';
import { IConfigService } from '#/app/config/config';
import { LifecycleScope } from '#/app/scopes';
import { InMemorySkillCatalog } from '#/features/skill/catalog/registry';
import type { SkillCatalog } from '#/features/skill/catalog/types';
import {
  ISessionSkillCatalog,
  type ISkillCatalogSink,
} from '#/features/skill/session/skillCatalog';
import { ISessionSkillCatalogData } from '#/features/skill/session/skillCatalogData';
import { SessionSkillCatalogService } from '#/features/skill/session/skillCatalogService';
import { ISessionStateService } from '#/session/state/sessionState';
import { SessionStateService } from '#/session/state/sessionStateService';
import { IWorkspaceStateService } from '#/workspace/state/workspaceState';
import { WorkspaceStateService } from '#/workspace/state/workspaceStateService';

import { StubConfigService } from '../../../stubs';
import { stubSkill } from '../catalog/stubs';

function dataSeed(initial: InMemorySkillCatalog): {
  readonly data: ISessionSkillCatalogData;
  readonly changes: Emitter<string>;
  replace(next: InMemorySkillCatalog): void;
} {
  let current: SkillCatalog = initial;
  const changes = new Emitter<string>();
  return {
    changes,
    data: {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: changes.event,
      get catalog() {
        return current;
      },
    },
    replace(next: InMemorySkillCatalog) {
      current = next;
    },
  };
}

function catalogOf(...skills: readonly ReturnType<typeof stubSkill>[]): InMemorySkillCatalog {
  const catalog = new InMemorySkillCatalog();
  for (const skill of skills) catalog.register(skill, { replace: true });
  return catalog;
}

describe('SessionSkillCatalogService (seed view)', () => {
  beforeEach(() => {
    _clearScopedRegistryForTests();
    registerScopedService(LifecycleScope.Session, ISessionStateService, SessionStateService);
    registerScopedService(LifecycleScope.Session, ISessionSkillCatalog, SessionSkillCatalogService);
  });

  function makeSession(data: ISessionSkillCatalogData, config: IConfigService = new StubConfigService()) {
    const host = createScopedTestHost([]);
    const session = host.child(LifecycleScope.Session, 's1', [
      stubPair(ISessionSkillCatalogData, data),
      stubPair(IWorkspaceStateService, new WorkspaceStateService()),
      stubPair(IConfigService, config),
    ]);
    return { host, catalog: session.accessor.get(ISessionSkillCatalog) };
  }

  it('exposes the seeded snapshot after ready', async () => {
    const seed = dataSeed(catalogOf(stubSkill('from-workspace')));
    const { host, catalog } = makeSession(seed.data);

    await catalog.load();
    expect(catalog.catalog.getSkill('from-workspace')).toBeDefined();
    host.dispose();
  });

  it('re-folds and forwards the source id when the seed fires a change', async () => {
    const seed = dataSeed(catalogOf(stubSkill('before')));
    const { host, catalog } = makeSession(seed.data);
    await catalog.load();

    const seen: string[] = [];
    const subscription = catalog.onDidChange((sourceId) => seen.push(sourceId));
    seed.replace(catalogOf(stubSkill('after')));
    seed.changes.fire('workspace');

    expect(catalog.catalog.getSkill('before')).toBeUndefined();
    expect(catalog.catalog.getSkill('after')).toBeDefined();
    expect(seen).toEqual(['workspace']);
    subscription.dispose();
    host.dispose();
  });

  it('merges ad-hoc sink contributions over the seed and drops them on remove', async () => {
    const seed = dataSeed(catalogOf(stubSkill('shared', { description: 'from workspace' })));
    const { host, catalog } = makeSession(seed.data);
    await catalog.load();

    const sink = catalog as unknown as ISkillCatalogSink;
    sink.set(
      'adhoc',
      { skills: [stubSkill('shared', { description: 'from adhoc' }), stubSkill('adhoc-only')] },
      { priority: 40 },
    );
    expect(catalog.catalog.getSkill('shared')?.description).toBe('from adhoc');
    expect(catalog.catalog.getSkill('adhoc-only')).toBeDefined();

    sink.remove('adhoc');
    expect(catalog.catalog.getSkill('shared')?.description).toBe('from workspace');
    expect(catalog.catalog.getSkill('adhoc-only')).toBeUndefined();
    host.dispose();
  });

  it('reload re-folds the current seed without rescanning and fires catalog', async () => {
    const seed = dataSeed(catalogOf(stubSkill('one')));
    const { host, catalog } = makeSession(seed.data);
    await catalog.load();

    seed.replace(catalogOf(stubSkill('two')));
    const seen: string[] = [];
    const subscription = catalog.onDidChange((sourceId) => seen.push(sourceId));
    await catalog.reload();

    expect(catalog.catalog.getSkill('two')).toBeDefined();
    expect(seen).toEqual(['catalog']);
    subscription.dispose();
    host.dispose();
  });

  it('list returns plain summaries of the merged catalog after ready', async () => {
    const seed = dataSeed(
      catalogOf(stubSkill('from-workspace', { description: 'seeded', source: 'project' })),
    );
    const { host, catalog } = makeSession(seed.data);
    (catalog as unknown as ISkillCatalogSink).set(
      'adhoc',
      { skills: [stubSkill('adhoc-only', { source: 'extra' })] },
      { priority: 40 },
    );

    const summaries = await catalog.list();
    expect(summaries).toHaveLength(2);
    const seeded = summaries.find((summary) => summary.name === 'from-workspace');
    expect(seeded).toMatchObject({
      name: 'from-workspace',
      description: 'seeded',
      source: 'project',
    });
    expect(Object.keys(seeded ?? {})).not.toContain('content');
    expect(summaries.some((summary) => summary.name === 'adhoc-only')).toBe(true);
    host.dispose();
  });

  it('excludes skills named in disabledSkills config from seed and sink contributions', async () => {
    const seed = dataSeed(catalogOf(stubSkill('blocked-seed'), stubSkill('allowed')));
    const config = new StubConfigService({ disabledSkills: ['Blocked-Seed', 'BLOCKED-SINK'] });
    const { host, catalog } = makeSession(seed.data, config);
    await catalog.load();

    const sink = catalog as unknown as ISkillCatalogSink;
    sink.set(
      'adhoc',
      { skills: [stubSkill('blocked-sink'), stubSkill('adhoc-allowed')] },
      { priority: 40 },
    );

    expect(catalog.catalog.getSkill('blocked-seed')).toBeUndefined();
    expect(catalog.catalog.getSkill('blocked-sink')).toBeUndefined();
    expect(catalog.catalog.getSkill('allowed')).toBeDefined();
    expect(catalog.catalog.getSkill('adhoc-allowed')).toBeDefined();

    const summaries = await catalog.list();
    expect(summaries.map((summary) => summary.name).toSorted()).toEqual([
      'adhoc-allowed',
      'allowed',
    ]);
    host.dispose();
  });

  it('treats unreadable config as no disabled skills', async () => {
    const seed = dataSeed(catalogOf(stubSkill('present')));
    const config = new StubConfigService();
    config.get = () => {
      throw new Error('config not ready');
    };
    const { host, catalog } = makeSession(seed.data, config);
    await catalog.load();
    expect(catalog.catalog.getSkill('present')).toBeDefined();
    host.dispose();
  });

  it('re-merges and fires onDidChange once config becomes ready', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seed = dataSeed(catalogOf(stubSkill('late-blocked'), stubSkill('late-allowed')));
    const config = new StubConfigService({ disabledSkills: ['late-blocked'] });
    Object.defineProperty(config, 'ready', { value: gate });
    const { host, catalog } = makeSession(seed.data, config);
    await catalog.load();

    const seen: string[] = [];
    const subscription = catalog.onDidChange((sourceId) => seen.push(sourceId));
    release();
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(catalog.catalog.getSkill('late-blocked')).toBeUndefined();
    expect(seen).toEqual(['config']);
    subscription.dispose();
    host.dispose();
  });
});
