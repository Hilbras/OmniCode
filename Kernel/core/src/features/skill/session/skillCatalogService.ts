import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { Service } from '@hilbras/omnicode-base/di/service';
import { Emitter, type Event } from '@hilbras/omnicode-base/event';
import { IConfigService } from '#/app/config/config';
import { LifecycleScope } from '#/app/scopes';
import {
  DISABLED_SKILLS_SECTION,
  type DisabledSkillsConfig,
} from '#/features/skill/catalog/configSection';
import { InMemorySkillCatalog } from '#/features/skill/catalog/registry';
import type { SkillContribution } from '#/features/skill/catalog/skillSource';
import {
  summarizeSkill,
  type SkillCatalog,
  type SkillSummary,
} from '#/features/skill/catalog/types';
import { ISessionStateService } from '#/session/state/sessionState';
import { defineState } from '#/state/state';

import { ISessionSkillCatalog, type ISkillCatalogSink } from './skillCatalog';
import { ISessionSkillCatalogData } from './skillCatalogData';

export const skillCatalogContributionsKey = defineState<
  Map<string, { readonly c: SkillContribution; readonly priority: number }>
>('sessionSkillCatalog.contributions', () => new Map());
export const skillCatalogMergedKey = defineState<InMemorySkillCatalog>(
  'sessionSkillCatalog.merged',
  () => new InMemorySkillCatalog(),
);

export class SessionSkillCatalogService
  extends Service
  implements ISessionSkillCatalog, ISkillCatalogSink
{
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  private readonly onDidChangeEmitter = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this.onDidChangeEmitter.event;

  constructor(
    @ISessionSkillCatalogData private readonly data: ISessionSkillCatalogData,
    @ISessionStateService private readonly states: ISessionStateService,
    @IConfigService private readonly configService: IConfigService,
  ) {
    super();
    this.states.contributeState(skillCatalogContributionsKey);
    this.states.contributeState(skillCatalogMergedKey);
    this._register(
      this.data.onDidChange((sourceId) => {
        this.remerge();
        this.onDidChangeEmitter.fire(sourceId);
      }),
    );
    this.remerge();
    this.ready = this.data.ready.then(() => this.remerge());
    void this.configService.ready.then(() => {
      this.remerge();
      this.onDidChangeEmitter.fire('config');
    });
  }

  private get contributions(): Map<
    string,
    { readonly c: SkillContribution; readonly priority: number }
  > {
    return this.states.get(skillCatalogContributionsKey);
  }

  private get merged(): InMemorySkillCatalog {
    return this.states.get(skillCatalogMergedKey);
  }

  private set merged(value: InMemorySkillCatalog) {
    this.states.set(skillCatalogMergedKey, value);
  }

  get catalog(): SkillCatalog {
    return this.merged;
  }

  async load(): Promise<void> {
    await this.ready;
  }

  async reload(): Promise<void> {
    await this.ready;
    this.remerge();
    this.onDidChangeEmitter.fire('catalog');
  }

  async list(): Promise<readonly SkillSummary[]> {
    await this.ready;
    return this.catalog.listSkills().map(summarizeSkill);
  }

  set(id: string, c: SkillContribution, { priority }: { readonly priority: number }): void {
    this.contributions.set(id, { c, priority });
    this.remerge();
    this.onDidChangeEmitter.fire(id);
  }

  remove(id: string): void {
    this.contributions.delete(id);
    this.remerge();
    this.onDidChangeEmitter.fire(id);
  }

  private disabledSkills(): ReadonlySet<string> {
    try {
      const list = this.configService.get<DisabledSkillsConfig>(DISABLED_SKILLS_SECTION) ?? [];
      return new Set(list.map((name) => name.toLowerCase()));
    } catch {
      return new Set();
    }
  }

  private remerge(): void {
    const m = new InMemorySkillCatalog();
    const disabled = this.disabledSkills();
    const base = this.data.catalog;
    for (const skill of base.listSkills()) {
      if (!disabled.has(skill.name.toLowerCase())) m.register(skill, { replace: true });
    }
    m.addRoots(base.getSkillRoots());
    m.recordSkipped(base.getSkippedByPolicy());
    const ordered = [...this.contributions.values()].toSorted((a, b) => a.priority - b.priority);
    for (const { c } of ordered) {
      for (const skill of c.skills) {
        if (!disabled.has(skill.name.toLowerCase())) m.register(skill, { replace: true });
      }
      m.addRoots(c.scannedRoots ?? []);
      m.recordSkipped(c.skipped ?? []);
    }
    this.merged = m;
  }
}

registerScopedService(
  LifecycleScope.Session,
  ISessionSkillCatalog,
  SessionSkillCatalogService,
  ScopeActivation.OnScopeCreated,
  'sessionSkillCatalog',
);
