import { join } from 'node:path';

import type { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import type { IConfigService } from '@hilbras/omnicode-core/app/config/config';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import type { ILogger } from '@hilbras/omnicode-core/_base/log/log';

import { MemoryError, MemoryErrors } from '#/contracts/errors';

import { MEMORY_SECTION, type MemoryConfig } from '#/feature/configSection';
import { MEMORY_FLAG_ID } from '#/feature/flag';
import { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';
import type {
  MemoryStoreOp,
  MemoryStorePort,
  MemoryTextSearchOptions,
  MemoryTextSearchResult,
  TextIndexState,
} from '#/storage/memoryStore';

import { DEFAULT_MEMORY_SETTINGS, type MemoryPolicySettings } from './memorySettings';

export const MEMORY_DIR_NAME = 'memory';

export function resolveMemoryDir(bootstrap: IBootstrapService, config: IConfigService): string {
  return config.get<MemoryConfig | undefined>(MEMORY_SECTION)?.dir ?? join(bootstrap.homeDir, MEMORY_DIR_NAME);
}

export function resolveMemorySettings(
  bootstrap: IBootstrapService,
  config: IConfigService,
  dir: string,
): MemoryPolicySettings {
  const section = config.get<MemoryConfig | undefined>(MEMORY_SECTION);
  return {
    ...DEFAULT_MEMORY_SETTINGS,
    enabled: section?.enabled ?? true,
    dir,
    maxContentChars: section?.maxContentChars ?? DEFAULT_MEMORY_SETTINGS.maxContentChars,
    workingTtlMs: section?.workingTtlMs ?? DEFAULT_MEMORY_SETTINGS.workingTtlMs,
    workingGraceMs: section?.workingGraceMs ?? DEFAULT_MEMORY_SETTINGS.workingGraceMs,
    reviewMaxAttempts: section?.reviewMaxAttempts ?? DEFAULT_MEMORY_SETTINGS.reviewMaxAttempts,
    reviewBackoffMs: section?.reviewBackoffMs ?? DEFAULT_MEMORY_SETTINGS.reviewBackoffMs,
    maxQueuedReviews: section?.maxQueuedReviews ?? DEFAULT_MEMORY_SETTINGS.maxQueuedReviews,
  };
}

export class LazyMemoryStore implements MemoryStorePort {
  private opening: Promise<MemoryStorePort> | undefined;

  constructor(
    private readonly open: () => Promise<MemoryStorePort>,
    private readonly enabled: () => boolean,
  ) {}

  async get(key: string): Promise<unknown> {
    return (await this.db()).get(key);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>> {
    return (await this.db()).getMany(keys);
  }

  async commit(ops: readonly MemoryStoreOp[]): Promise<void> {
    return (await this.db()).commit(ops);
  }

  async prefixKeys(prefix: string, limit: number): Promise<readonly string[]> {
    return (await this.db()).prefixKeys(prefix, limit);
  }

  async searchText(options: MemoryTextSearchOptions): Promise<MemoryTextSearchResult> {
    return (await this.db()).searchText(options);
  }

  async textIndexState(): Promise<TextIndexState> {
    return (await this.db()).textIndexState();
  }

  async close(): Promise<void> {
    const store = await this.opening?.catch(() => undefined);
    this.opening = undefined;
    await store?.close();
  }

  private async db(): Promise<MemoryStorePort> {
    if (!this.enabled()) {
      throw new MemoryError(MemoryErrors.codes.STORAGE_UNAVAILABLE, 'memory is disabled');
    }
    this.opening ??= this.open();
    return this.opening;
  }
}

export interface MemoryRuntimeDeps {
  readonly bootstrap: IBootstrapService;
  readonly config: IConfigService;
  readonly flags: IFlagService;
  readonly log: ILogger;
}

export interface MemoryRuntime {
  readonly store: MemoryStorePort;
  readonly settings: MemoryPolicySettings;
  readonly available: () => boolean;
  readonly injectCanonical: () => boolean;
  readonly now: () => number;
}

export function createMemoryRuntime(deps: MemoryRuntimeDeps, now: () => number = () => Date.now()): MemoryRuntime {
  const dir = resolveMemoryDir(deps.bootstrap, deps.config);
  const settings = resolveMemorySettings(deps.bootstrap, deps.config, dir);
  const enabled = (): boolean => deps.flags.enabled(MEMORY_FLAG_ID) && settings.enabled;
  const injectCanonical = (): boolean => {
    const section = deps.config.get<MemoryConfig | undefined>(MEMORY_SECTION);
    return section?.injectCanonical ?? true;
  };
  return {
    store: new LazyMemoryStore(
      () =>
        MiniDbMemoryStore.open({
          dir,
          onError: (error) => {
            deps.log.warn('memory store error', { dir, error: error instanceof Error ? error.message : String(error) });
          },
        }),
      enabled,
    ),
    settings,
    available: enabled,
    injectCanonical,
    now,
  };
}