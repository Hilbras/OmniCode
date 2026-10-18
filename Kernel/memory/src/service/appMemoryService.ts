import { isAbsolute, join } from 'node:path';

import { Disposable, toDisposable } from '@hilbras/omnicode-core/_base/di/lifecycle';
import type { IDisposable } from '@hilbras/omnicode-core/_base/di/lifecycle';
import { ILogService } from '@hilbras/omnicode-core/_base/log/log';
import { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import { IConfigService } from '@hilbras/omnicode-core/app/config/config';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';

import { IMemoryService } from '#/contracts/memoryContract';
import type {
  MemoryApprovalRequest,
  MemoryCaptureInput,
  MemoryCaptureResult,
  MemoryDiagnostics,
  MemoryEvidenceRefreshOptions,
  MemoryEvidenceRefreshReport,
  MemoryListQuery,
  MemoryMutationResult,
  MemoryPromotionRequest,
  MemoryReviewJob,
  MemoryReviewReport,
  MemorySearchQuery,
  MemoryStaleReport,
  MemorySupersedeInput,
  MemoryTaskRestore,
  MemoryTaskStateInput,
  MemoryUpdatePatch,
} from '#/contracts/memoryContract';
import type { MemoryRecord, MemoryTier } from '#/contracts/memoryTypes';
import type { RetrievalResult } from '#/contracts/retrieval';

import { IHostFileSystem } from '@hilbras/omnicode-core/os/interface/hostFileSystem';

import { MemoryMaintenanceScheduler } from './memoryMaintenance';
import { resolveProjectIdentity, type ProjectIdentity } from './projectIdentity';
import { MemoryService } from './memoryService';
import { createMemoryRuntime } from './memoryRuntime';

export class AppMemoryService extends Disposable implements IMemoryService {
  declare readonly _serviceBrand: undefined;

  private readonly delegate: MemoryService;
  private readonly maintenance: MemoryMaintenanceScheduler;
  private readonly runtimeEnabled: () => boolean;
  private readonly canonicalInjectionEnabled: () => boolean;
  private readonly identity: Promise<ProjectIdentity | undefined>;
  private evidenceProjectId(): string | undefined {
    return this.resolvedProjectId;
  }

  private resolvedProjectId: string | undefined;

  constructor(
    @IBootstrapService bootstrap: IBootstrapService,
    @IConfigService config: IConfigService,
    @IFlagService flags: IFlagService,
    @ILogService log: ILogService,
    @IHostFileSystem fs: IHostFileSystem,
  ) {
    super();
    const runtime = createMemoryRuntime({ bootstrap, config, flags, log });
    const now = runtime.now;
    this.identity = resolveProjectIdentity(fs, bootstrap.cwd).then((resolved) => {
      this.resolvedProjectId = resolved?.projectId;
      return resolved;
    });
    this.runtimeEnabled = runtime.available;
    this.canonicalInjectionEnabled = runtime.injectCanonical;
    this.delegate = new MemoryService({
      store: runtime.store,
      log,
      settings: runtime.settings,
      available: runtime.available,
      now,
      ownsStore: true,
      readEvidence: (ref) => readProjectFile(fs, bootstrap.cwd, ref),
    });
    this.maintenance = new MemoryMaintenanceScheduler({
      memory: this.delegate,
      log,
      enabled: runtime.available,
      workingGraceMs: runtime.settings.workingGraceMs,
      now,
      evidenceProjectId: () => this.evidenceProjectId(),
    });
    this.maintenance.start();
    const delegate = this.delegate;
    const maintenance = this.maintenance;
    this._register(toDisposable(() => {
      maintenance.dispose();
      delegate.dispose();
    }));
  }

  get scheduler(): MemoryMaintenanceScheduler {
    return this.maintenance;
  }

  get ready(): Promise<void> {
    return this.delegate.ready;
  }

  get enabled(): boolean {
    return this.delegate.enabled && this.runtimeEnabled();
  }

  get injectCanonical(): boolean {
    return this.canonicalInjectionEnabled() && this.delegate.enabled;
  }

  capture(input: MemoryCaptureInput): Promise<MemoryCaptureResult> {
    return this.delegate.capture(input).then((result) => {
      if (result.status === 'queued') this.maintenance.notifyQueued();
      return result;
    });
  }

  get(id: string): Promise<MemoryRecord | undefined> {
    return this.delegate.get(id);
  }

  list(query: MemoryListQuery): Promise<readonly MemoryRecord[]> {
    return this.delegate.list(query);
  }

  search(query: MemorySearchQuery): Promise<RetrievalResult> {
    return this.delegate.search(query);
  }

  update(id: string, patch: MemoryUpdatePatch): Promise<MemoryMutationResult> {
    return this.delegate.update(id, patch);
  }

  supersede(id: string, input: MemorySupersedeInput): Promise<MemoryMutationResult> {
    return this.delegate.supersede(id, input);
  }

  invalidate(id: string, reason: string): Promise<MemoryMutationResult> {
    return this.delegate.invalidate(id, reason);
  }

  delete(id: string, reason: string): Promise<MemoryMutationResult> {
    return this.delegate.delete(id, reason);
  }

  promote(request: MemoryPromotionRequest): Promise<MemoryMutationResult> {
    return this.delegate.promote(request);
  }

  approveCanonical(request: MemoryApprovalRequest): Promise<MemoryMutationResult> {
    return this.delegate.approveCanonical(request);
  }

  noteAccess(ids: readonly string[], at: number): Promise<number> {
    return this.delegate.noteAccess(ids, at);
  }

  resetAccessCount(id: string): Promise<MemoryMutationResult> {
    return this.delegate.resetAccessCount(id);
  }

  expireDue(now: number): Promise<readonly MemoryRecord[]> {
    return this.delegate.expireDue(now);
  }

  purgeWorking(olderThan: number): Promise<readonly string[]> {
    return this.delegate.purgeWorking(olderThan);
  }

  saveTaskState(input: MemoryTaskStateInput): Promise<MemoryCaptureResult> {
    return this.delegate.saveTaskState(input);
  }

  restoreTaskState(input: MemoryTaskStateInput): Promise<MemoryTaskRestore> {
    return this.delegate.restoreTaskState(input);
  }

  markStale(
    fingerprints: ReadonlyMap<string, string>,
    options: { readonly projectId?: string; readonly tiers?: readonly MemoryTier[] },
  ): Promise<MemoryStaleReport> {
    return this.delegate.markStale(fingerprints, options);
  }

  refreshEvidence(options?: MemoryEvidenceRefreshOptions): Promise<MemoryEvidenceRefreshReport> {
    return this.delegate.refreshEvidence(options);
  }

  runReview(limit: number): Promise<MemoryReviewReport> {
    return this.delegate.runReview(limit);
  }

  pendingReviews(now: number, limit: number): Promise<readonly MemoryReviewJob[]> {
    return this.delegate.pendingReviews(now, limit);
  }

  diagnostics(): Promise<MemoryDiagnostics> {
    return this.delegate.diagnostics();
  }
}

export type IMemoryRuntimeState = IDisposable & { readonly enabled: boolean };
async function readProjectFile(fs: IHostFileSystem, cwd: string, ref: string): Promise<string | undefined> {
  if (ref.length === 0 || ref.includes('..')) return undefined;
  const path = isAbsolute(ref) ? ref : join(cwd, ref);
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile || stat.size > MAX_EVIDENCE_BYTES) return undefined;
    return await fs.readText(path);
  } catch {
    return undefined;
  }
}

const MAX_EVIDENCE_BYTES = 1024 * 1024;
