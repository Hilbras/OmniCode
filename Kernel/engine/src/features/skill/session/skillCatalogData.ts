import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { ScopeSeed } from '@hilbras/omnicode-base/di/scope';
import type { Event } from '@hilbras/omnicode-base/event';

import type { SkillCatalog } from '#/features/skill/catalog/types';

export interface ISessionSkillCatalogData {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly catalog: SkillCatalog;
  readonly onDidChange: Event<string>;
}

export const ISessionSkillCatalogData: ServiceIdentifier<ISessionSkillCatalogData> =
  createDecorator<ISessionSkillCatalogData>('sessionSkillCatalogData');

export function sessionSkillCatalogDataSeed(data: ISessionSkillCatalogData): ScopeSeed {
  return [[ISessionSkillCatalogData as ServiceIdentifier<unknown>, data]];
}
