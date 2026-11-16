import { join } from 'node:path';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';

import { SkillCurator } from './curator';
import { NodeCuratorStore } from './store';
import type { SkillUsageRef, SkillUsageState, SkillUsageTrigger } from './usage';

/** Directory under the Omnicode home that holds curator state. */
export const SKILL_CURATOR_STATE_DIR = 'skill-curator';

export interface ISkillCuratorService {
  readonly _serviceBrand: undefined;
  recordUsage(
    ref: SkillUsageRef,
    event: { readonly trigger: SkillUsageTrigger; readonly at?: number },
  ): Promise<void>;
  usage(): Promise<SkillUsageState>;
}

export const ISkillCuratorService = createDecorator<ISkillCuratorService>('skillCuratorService');

/**
 * Composes the skill curator over the Omnicode home, so skill usage outlives a
 * session and can be curated across workspaces. Callers must treat it as
 * best-effort: curation is bookkeeping and never a reason to fail the action it
 * is recording.
 */
export class AgentSkillCuratorService implements ISkillCuratorService {
  declare readonly _serviceBrand: undefined;

  private readonly curator: SkillCurator;

  constructor(@IBootstrapService bootstrap: IBootstrapService) {
    this.curator = new SkillCurator({
      store: new NodeCuratorStore({
        rootDir: join(bootstrap.homeDir, SKILL_CURATOR_STATE_DIR),
      }),
    });
  }

  async recordUsage(
    ref: SkillUsageRef,
    event: { readonly trigger: SkillUsageTrigger; readonly at?: number },
  ): Promise<void> {
    await this.curator.recordUsage(ref, event);
  }

  async usage(): Promise<SkillUsageState> {
    return this.curator.usage();
  }
}
