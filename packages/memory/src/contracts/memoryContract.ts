import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

import type { MemoryAuthority } from './memoryAuthority';
import type {
  MemoryApproval,
  MemoryCategory,
  MemoryEvidence,
  MemoryLifecycle,
  MemoryOrigin,
  MemoryRecord,
  MemoryRelation,
  MemoryScope,
  MemoryScopeTier,
  MemoryRetention,
  MemorySensitivity,
  MemorySourceType,
  MemoryTier,
  MemoryTrust,
} from './memoryTypes';
import type { MemorySearchQuery, RetrievalResult } from './retrieval';

export type { MemorySearchQuery, RetrievalResult } from './retrieval';

export interface MemoryPolicyViolation {
  readonly rule: string;
  readonly message: string;
}

export interface MemoryCaptureInput {
  readonly content: string;
  readonly tier: MemoryTier;
  readonly category: MemoryCategory;
  readonly sourceType: MemorySourceType;
  readonly origin: MemoryOrigin;
  readonly scope: MemoryScope;
  readonly subject?: string;
  readonly sensitivity?: MemorySensitivity;
  readonly retention?: MemoryRetention;
  readonly importance?: number;
  readonly confidence?: number;
  readonly evidence?: readonly MemoryEvidence[];
  readonly derivedFrom?: readonly string[];
  readonly relations?: readonly MemoryRelation[];
  readonly authority?: MemoryAuthority;
  readonly approval?: MemoryApproval;
  readonly repoRevision?: string;
  readonly expiresAt?: number;
  readonly requestKey?: string;
  readonly review?: 'immediate' | 'queued';
}

export type MemoryCaptureStatus = 'stored' | 'queued' | 'deduplicated' | 'rejected' | 'failed';

export type MemoryDigestDecision = 'store' | 'skip' | 'merge';

export interface MemoryDigestCandidate {
  readonly existing: MemoryRecord;
  readonly incoming: MemoryCaptureInput;
}

export interface MemoryDigestInput {
  readonly items: readonly MemoryCaptureInput[];
  readonly merge?: boolean;
  readonly adjudicate?: (candidate: MemoryDigestCandidate) => Promise<MemoryDigestDecision>;
}

export interface MemoryDreamConsolidationInput {
  readonly scope?: MemoryScope;
  readonly tier?: MemoryTier;
  readonly category?: MemoryCategory;
  readonly limit?: number;
  readonly dryRun?: boolean;
}


export type MemoryFeedback = 'useful' | 'harmful' | 'irrelevant';

export interface MemoryFeedbackInput {
  readonly memoryId: string;
  readonly feedback: MemoryFeedback;
  readonly actor?: 'user' | 'model' | 'application';
  readonly turnId?: number;
}

export interface MemoryFeedbackResult {
  readonly status: 'recorded' | 'not_found' | 'disabled';
  readonly feedback?: MemoryFeedback;
  readonly count?: number;
}

export interface MemoryRecalibrationResult {
  readonly status: 'promoted' | 'demoted' | 'skipped' | 'cooldown' | 'not_found' | 'system' | 'disabled';
  readonly from?: MemoryTrust;
  readonly to?: MemoryTrust;
  readonly reason?: string;
}

export interface MemoryAuditRecord {
  readonly id: string;
  readonly at: number;
  readonly actor: 'user' | 'model' | 'application';
  readonly operation: string;
  readonly memoryId: string;
  readonly reason: string;
  readonly effect: string;
}

export interface MemoryVersion {
  readonly memoryId: string;
  readonly revision: number;
  readonly record: MemoryRecord;
  readonly reason: string;
  readonly at: number;
}

export interface MemoryDigestItemResult {
  readonly status: 'stored' | 'deduplicated' | 'merged' | 'skipped' | 'rejected';
  readonly id?: string;
  readonly reason?: string;
}

export interface MemoryDigestResult {
  readonly stored: number;
  readonly deduplicated: number;
  readonly merged: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly items: readonly MemoryDigestItemResult[];
}

export interface MemoryDreamConsolidationResult {
  readonly status: 'completed' | 'disabled' | 'failed';
  readonly scope: MemoryScope;
  readonly scanned: number;
  readonly groups: number;
  readonly consolidated: number;
  readonly superseded: number;
  readonly skipped: number;
  readonly ids: readonly string[];
  readonly reason?: string;
}


export interface MemoryCaptureResult {
  readonly status: MemoryCaptureStatus;
  readonly id?: string;
  readonly record?: MemoryRecord;
  readonly reason?: string;
  readonly violations?: readonly MemoryPolicyViolation[];
}

export interface MemoryUpdatePatch {
  readonly content?: string;
  readonly subject?: string;
  readonly sensitivity?: MemorySensitivity;
  readonly retention?: MemoryRetention;
  readonly importance?: number;
  readonly confidence?: number;
  readonly evidence?: readonly MemoryEvidence[];
  readonly expiresAt?: number;
}

export interface MemorySupersedeInput {
  readonly successorId: string;
  readonly reason: string;
}

export interface MemoryMutationResult {
  readonly status: 'updated' | 'not_found' | 'rejected' | 'failed';
  readonly record?: MemoryRecord;
  readonly reason?: string;
  readonly violations?: readonly MemoryPolicyViolation[];
}

export interface MemoryPromotionRequest {
  readonly id: string;
  readonly to: MemoryTrust;
  readonly origin: MemoryOrigin;
  readonly authority?: MemoryAuthority;
  readonly evidence?: readonly MemoryEvidence[];
}

export interface MemoryApprovalRequest {
  readonly id: string;
  readonly by: MemoryApproval['by'];
  readonly reason: string;
  readonly authority?: MemoryAuthority;
}

export interface MemoryListQuery {
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly scopes?: readonly MemoryScopeTier[];
  readonly tiers?: readonly MemoryTier[];
  readonly categories?: readonly MemoryCategory[];
  readonly lifecycle?: readonly MemoryLifecycle[];
  readonly limit?: number;
}

export interface MemoryTaskState {
  readonly objective: string;
  readonly completed: readonly string[];
  readonly active?: readonly string[];
  readonly decisions: readonly string[];
  readonly failedAttempts: readonly string[];
  readonly blockers: readonly string[];
  readonly fileRefs: readonly string[];
  readonly nextAction?: string;
}

export interface MemoryTaskStateInput extends MemoryTaskState {
  readonly taskId: string;
  readonly scope: MemoryScope;
  readonly sessionId?: string;
  readonly projectId?: string;
  readonly evidence?: readonly MemoryEvidence[];
  readonly ttlMs?: number;
}

export interface MemoryStaleFinding {
  readonly memoryId: string;
  readonly evidenceRef: string;
  readonly previousFingerprint?: string;
  readonly observedFingerprint: string;
}

export interface MemoryEvidenceRefreshReport {
  readonly status: 'checked' | 'unavailable';
  readonly checked: number;
  readonly changed: number;
  readonly unreadable: number;
  readonly report: MemoryStaleReport;
}

export interface MemoryEvidenceRefreshOptions {
  readonly projectId?: string;
  readonly limit?: number;
}

export interface MemoryStaleReport {
  readonly status: 'checked' | 'unavailable' | 'failed';
  readonly checked: number;
  readonly marked: number;
  readonly findings: readonly MemoryStaleFinding[];
  readonly reason?: string;
}

export interface MemoryReviewReport {
  readonly processed: number;
  readonly stored: number;
  readonly deduplicated: number;
  readonly skipped: number;
  readonly retrying: number;
  readonly failed: number;
  readonly jobs: readonly MemoryReviewJobReport[];
}

export type MemoryReviewOutcome = 'done' | 'skipped' | 'retrying' | 'failed';

export interface MemoryReviewJobReport {
  readonly jobId: string;
  readonly status: MemoryReviewOutcome;
  readonly attempts: number;
  readonly reason?: string;
  readonly memoryId?: string;
}

export type MemoryReviewJobStatus = 'pending' | 'processing' | 'done' | 'skipped' | 'failed';

export interface MemoryReviewJob {
  readonly id: string;
  readonly status: MemoryReviewJobStatus;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly input: MemoryCaptureInput;
  readonly memoryId?: string;
  readonly reason?: string;
  readonly lastError?: string;
}

export interface MemoryDiagnostics {
  readonly status: 'ok' | 'degraded' | 'unavailable';
  readonly storeDir: string;
  readonly schemaVersion: number;
  readonly textIndex: 'ready' | 'building' | 'absent';
  readonly readOnly: boolean;
  readonly counts: Readonly<Record<MemoryTier, number>>;
  readonly lifecycleCounts: Readonly<Record<MemoryLifecycle, number>>;
  readonly pendingReviews: number;
  readonly failedReviews: number;
  readonly lastError?: string;
}

export interface IMemoryService {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;

  readonly enabled: boolean;

  readonly injectCanonical: boolean;

  capture(input: MemoryCaptureInput): Promise<MemoryCaptureResult>;

  digest(input: MemoryDigestInput): Promise<MemoryDigestResult>;

  dreamConsolidate(input?: MemoryScope | MemoryDreamConsolidationInput): Promise<MemoryDreamConsolidationResult>;

  consolidateDream(input?: MemoryScope | MemoryDreamConsolidationInput): Promise<MemoryDreamConsolidationResult>;

  consolidate(input?: MemoryScope | MemoryDreamConsolidationInput): Promise<MemoryDreamConsolidationResult>;

  dream(input?: MemoryScope | MemoryDreamConsolidationInput): Promise<MemoryDreamConsolidationResult>;

  runDreamConsolidation(input?: MemoryScope | MemoryDreamConsolidationInput): Promise<MemoryDreamConsolidationResult>;

  history(id: string): Promise<readonly MemoryVersion[]>;

  auditLog(limit: number): Promise<readonly MemoryAuditRecord[]>;

  setLegalHold(id: string, hold: boolean, reason: string): Promise<MemoryMutationResult>;

  recordFeedback(input: MemoryFeedbackInput): Promise<MemoryFeedbackResult>;

  recalibrateTrust(memoryId: string, now?: number): Promise<MemoryRecalibrationResult>;

  get(id: string): Promise<MemoryRecord | undefined>;

  list(query: MemoryListQuery): Promise<readonly MemoryRecord[]>;

  search(query: MemorySearchQuery): Promise<RetrievalResult>;

  update(id: string, patch: MemoryUpdatePatch): Promise<MemoryMutationResult>;

  supersede(id: string, input: MemorySupersedeInput): Promise<MemoryMutationResult>;

  invalidate(id: string, reason: string): Promise<MemoryMutationResult>;

  delete(id: string, reason: string): Promise<MemoryMutationResult>;

  promote(request: MemoryPromotionRequest): Promise<MemoryMutationResult>;

  approveCanonical(request: MemoryApprovalRequest): Promise<MemoryMutationResult>;

  noteAccess(ids: readonly string[], at: number): Promise<number>;

  expireDue(now: number): Promise<readonly MemoryRecord[]>;

  purgeWorking(olderThan: number): Promise<readonly string[]>;

  saveTaskState(input: MemoryTaskStateInput): Promise<MemoryCaptureResult>;

  restoreTaskState(query: MemoryTaskStateInput): Promise<MemoryTaskRestore>;

  markStale(
    fingerprints: ReadonlyMap<string, string>,
    options: { readonly projectId?: string; readonly tiers?: readonly MemoryTier[] },
  ): Promise<MemoryStaleReport>;

  refreshEvidence(options?: MemoryEvidenceRefreshOptions): Promise<MemoryEvidenceRefreshReport>;

  runReview(limit: number): Promise<MemoryReviewReport>;

  pendingReviews(now: number, limit: number): Promise<readonly MemoryReviewJob[]>;

  diagnostics(): Promise<MemoryDiagnostics>;

  resetAccessCount(id: string): Promise<MemoryMutationResult>;

  recordPhrase(scope: MemoryScope, ngram: string): Promise<void>;

  topPhrases(scope: MemoryScope, limit: number): Promise<
    readonly { readonly ngram: string; readonly count: number; readonly lastSeenAt: number }[]
  >;
}

export const IMemoryService = createDecorator<IMemoryService>('memoryService');

export interface MemoryTaskRestore {
  readonly status: 'restored' | 'missing' | 'stale' | 'unavailable';
  readonly record?: MemoryRecord;
  readonly staleEvidence?: readonly { readonly ref: string; readonly reason: string }[];
  readonly reason?: string;
}