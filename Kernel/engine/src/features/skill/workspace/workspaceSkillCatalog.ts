import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { Event } from '@hilbras/omnicode-base/event';

import type { SkillCatalog } from '#/features/skill/catalog/types';
import type { ISessionSkillCatalogData } from '#/features/skill/session/skillCatalogData';

export interface IWorkspaceSkillCatalog {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly catalog: SkillCatalog;
  readonly onDidChange: Event<string>;
  load(): Promise<void>;
  reload(): Promise<void>;
  reloadSources(ids: readonly string[]): Promise<void>;
  sessionData(): ISessionSkillCatalogData;
}

export const IWorkspaceSkillCatalog: ServiceIdentifier<IWorkspaceSkillCatalog> =
  createDecorator<IWorkspaceSkillCatalog>('workspaceSkillCatalog');
