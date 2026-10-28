import { Disposable, toDisposable } from '@hilbras/omnicode-core/_base/di/lifecycle';
import type { ILogger } from '@hilbras/omnicode-core/_base/log/log';

import { MemoryError, MemoryErrors } from '#/contracts/errors';
import { resolveMemoryAuthority } from '#/contracts/memoryAuthority';
import type {
  IMemoryService,
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
  MemoryReviewJobReport,
  MemoryReviewReport,
  MemorySearchQuery,
  MemoryStaleFinding,
  MemoryStaleReport,
  MemorySupersedeInput,
  MemoryTaskRestore,
  MemoryTaskStateInput,
  MemoryTaskState,
  MemoryUpdatePatch,
} from '#/contracts/memoryContract';
import type { MemoryLifecycle, MemoryRecord, MemoryScope, MemoryTier } from '#/contracts/memoryTypes';
import { MEMORY_LIFECYCLES, MEMORY_TIERS, parseMemoryRecord, TRUST_RANK } from '#/contracts/memoryTypes';
import type { RetrievalResult } from '#/contracts/retrieval';
import { MemoryRetriever, unavailableResult } from '#/retrieval/memoryRetriever';
import {
  ALL_SCOPE_PREFIXES,
  fingerprintKey,
  idempotencyKey,
  MEMORY_SCHEMA_VERSION,
  PHRASE_PREFIX,
  pointerIds,
  recordKey,
  referenceKeys,
  referenceValues,
  REVIEW_PREFIX,
  reviewKey,
  scopeKeyFor,
  scopePrefix,
  subjectPrefixFor,
} from '#/storage/memoryKeys';
import type { MemoryStoreOp, MemoryStorePort } from '#/storage/memoryStore';
import { checkTierAdmission, evaluatePromotion } from '#/trust/trustPolicy';

import { fingerprintText, isFingerprintOfKind } from './evidence';
import { buildRecord, withUpdated } from './memoryRecordFactory';
import { DEFAULT_MEMORY_SETTINGS, type MemoryPolicySettings } from './memorySettings';
import { subjectFor } from './subjectInference';

export interface MemoryServiceDeps {
  readonly store: MemoryStorePort;
  readonly log: ILogger;
  readonly settings?: MemoryPolicySettings;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly available?: () => boolean;
  readonly ownsStore?: boolean;
  readonly readEvidence?: (ref: string) => Promise<string | undefined>;
}

export const TASK_STATE_SUBJECT_PREFIX = 'task-state:';

let sequence = 0;

function defaultId(): string {
  sequence = (sequence + 1) % 0x1000;
  const stamp = Date.now().toString(36).padStart(9, '0');
  const salt = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `mem_${stamp}${sequence.toString(36).padStart(3, '0')}${salt}`;
}

export class MemoryService extends Disposable implements IMemoryService {
  declare readonly _serviceBrand: undefined;

  private readonly store: MemoryStorePort;
  private readonly log: ILogger;
  private readonly settings: MemoryPolicySettings;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly available: () => boolean;
  private readonly retriever: MemoryRetriever;
  private readonly readEvidence: ((ref: string) => Promise<string | undefined>) | undefined;
  private lastError: string | undefined;
  private closed = false;

  constructor(deps: MemoryServiceDeps) {
    super();
    this.store = deps.store;
    this.log = deps.log.child({ memory: 'service' });
    this.settings = deps.settings ?? DEFAULT_MEMORY_SETTINGS;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? defaultId;
    this.available = deps.available ?? (() => true);
    this.retriever = new MemoryRetriever({ store: this.store, now: this.now });
    this.readEvidence = deps.readEvidence;
    this._register(toDisposable(() => {
      this.closed = true;
    }));
    if (deps.ownsStore === true) {
      this._register(toDisposable(() => {
        void this.store.close();
      }));
    }
  }

  get ready(): Promise<void> {
    return Promise.resolve();
  }

  get enabled(): boolean {
    return this.settings.enabled && this.available();
  }

  get injectCanonical(): boolean {
    return this.settings.enabled && this.available();
  }

  async capture(input: MemoryCaptureInput): Promise<MemoryCaptureResult> {
    if (this.closed) return { status: 'rejected', reason: 'memory service is closed' };
    if (!this.settings.enabled) return { status: 'rejected', reason: 'memory is disabled' };
    if (!this.available()) return { status: 'rejected', reason: 'memory is unavailable' };

    const content = input.content.trim();
    if (content.length === 0) return { status: 'rejected', reason: 'empty content' };
    if (content.length > this.settings.maxContentChars) {
      return { status: 'rejected', reason: `content exceeds ${this.settings.maxContentChars} characters` };
    }
    if (scopeKeyFor(input.scope) === undefined) {
      return { status: 'rejected', reason: `scope '${input.scope.tier}' requires its identifying id` };
    }

    const idempotent = input.requestKey === undefined ? undefined : await this.resolveIdempotent(input.requestKey);
    if (idempotent !== undefined) {
      return { status: 'stored', id: idempotent.id, record: idempotent.record };
    }

    if (input.tier === 'canonical') {
      return {
        status: 'rejected',
        reason: 'canonical memory must be approved through approveCanonical, never captured directly',
      };
    }

    const draft = { ...input, content, subject: subjectFor(input, content) };
    const now = this.now();
    const built = buildRecord(draft, this.newId(), now);
    const violations = checkTierAdmission({
      tier: built.record.tier,
      category: built.record.category,
      origin: built.record.origin,
      trust: built.record.trust,
      authority: draft.authority,
      approval: draft.approval,
    });
    if (violations.length > 0) {
      return { status: 'rejected', reason: violations[0]?.message, violations };
    }
    if (draft.derivedFrom !== undefined && draft.derivedFrom.length > 0) {
      const missing = await this.missingSources(draft.derivedFrom);
      if (missing.length > 0) {
        return { status: 'rejected', reason: `derived memory references unknown sources: ${missing.join(', ')}` };
      }
    }

    if (input.review === 'queued') return this.enqueueReview(draft, now);

    const duplicate = await this.findDuplicate(built.record);
    if (duplicate !== undefined) {
      return { status: 'deduplicated', id: duplicate.id, record: duplicate, reason: 'identical content in scope' };
    }

    const resolution = await this.resolveConflicts(built.record, now);
    if (resolution.status === 'rejected') return resolution;
    const record = resolution.record;

    const ops: MemoryStoreOp[] = referenceValues(record).map((entry) => ({
      op: 'set' as const,
      key: entry.key,
      value: entry.value,
    }));
    for (const sibling of resolution.siblings) {
      ops.push({ op: 'set', key: recordKey(sibling.id), value: sibling });
      if (sibling.lifecycle === 'superseded') {
        ops.push({ op: 'del', key: fingerprintKey(sibling.fingerprint) });
      }
    }
    if (input.requestKey !== undefined) {
      ops.push({ op: 'set', key: idempotencyKey(input.requestKey), value: { id: record.id } });
    }

    const committed = await this.commit(ops);
    if (!committed) return { status: 'failed', reason: 'memory could not be stored' };

    this.log.info('memory captured', {
      memoryId: record.id,
      tier: record.tier,
      category: record.category,
      trust: record.trust,
      sourceType: record.sourceType,
      origin: record.origin,
      scope: record.scope.tier,
      suspicious: record.suspicious,
      superseded: resolution.siblings.filter((s) => s.lifecycle === 'superseded').map((s) => s.id),
    });
    return { status: 'stored', id: record.id, record };
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.read(id);
  }

  async list(query: MemoryListQuery): Promise<readonly MemoryRecord[]> {
    if (!this.available()) return [];
    const limit = Math.max(1, query.limit ?? 100);
    const records: MemoryRecord[] = [];
    for (const value of (await this.store.getMany(
      (await this.scopePointerKeys(this.listPrefixes(query), limit)).map(recordKey),
    )).values()) {
      const record = parseMemoryRecord(value);
      if (record === undefined) continue;
      if (query.tiers !== undefined && !query.tiers.includes(record.tier)) continue;
      if (query.categories !== undefined && !query.categories.includes(record.category)) continue;
      if (query.lifecycle !== undefined && !query.lifecycle.includes(record.lifecycle)) continue;
      records.push(record);
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return records.slice(0, limit);
  }

  async search(query: MemorySearchQuery): Promise<RetrievalResult> {
    if (!this.enabled) return unavailableResult(query);
    return this.retriever.search(query);
  }

  async update(id: string, patch: MemoryUpdatePatch): Promise<MemoryMutationResult> {
    const existing = await this.read(id);
    if (existing === undefined) return { status: 'not_found' };
    if (existing.lifecycle !== 'active') return { status: 'rejected', reason: `record is ${existing.lifecycle}` };

    const now = this.now();
    const content = (patch.content ?? existing.content).trim();
    if (content.length === 0) return { status: 'rejected', reason: 'empty content' };
    if (content.length > this.settings.maxContentChars) {
      return { status: 'rejected', reason: `content exceeds ${this.settings.maxContentChars} characters` };
    }
    const rebuilt = buildRecord(
      {
        content,
        tier: existing.tier,
        category: existing.category,
        sourceType: existing.sourceType,
        origin: existing.origin,
        scope: existing.scope,
        subject: patch.subject ?? existing.subject,
        evidence: patch.evidence ?? existing.evidence,
        derivedFrom: existing.derivedFrom,
        approval: existing.approval,
        repoRevision: existing.repoRevision,
        expiresAt: patch.expiresAt ?? existing.expiresAt,
      },
      existing.id,
      now,
    );
    const next = withUpdated(
      existing,
      {
        content: rebuilt.record.content,
        redactionCount: rebuilt.record.redactionCount,
        evidence: rebuilt.record.evidence,
        trust: existing.trust,
        trustReason: existing.trustReason,
        verification: existing.verification,
        suspicious: rebuilt.record.suspicious,
        suspicionReasons: rebuilt.record.suspicionReasons,
        subject: rebuilt.record.subject,
        expiresAt: rebuilt.record.expiresAt,
      },
      now,
    );
    if (!(await this.commit([{ op: 'set', key: recordKey(id), value: next }]))) {
      return { status: 'failed', reason: 'memory could not be updated' };
    }
    return { status: 'updated', record: next };
  }

  async supersede(id: string, input: MemorySupersedeInput): Promise<MemoryMutationResult> {
    const existing = await this.read(id);
    if (existing === undefined) return { status: 'not_found' };
    const successor = await this.read(input.successorId);
    if (successor === undefined) {
      return { status: 'rejected', reason: 'successor record does not exist; nothing was superseded' };
    }
    if (successor.id === existing.id) {
      return { status: 'rejected', reason: 'a record cannot supersede itself' };
    }
    const now = this.now();
    const next = withUpdated(
      existing,
      { lifecycle: 'superseded' satisfies MemoryLifecycle, supersededBy: successor.id },
      now,
    );
    if (!(await this.commit([{ op: 'set', key: recordKey(existing.id), value: next }]))) {
      return { status: 'failed', reason: 'supersession was not durable' };
    }
    this.log.info('memory superseded', { memoryId: existing.id, successorId: successor.id, reason: input.reason });
    return { status: 'updated', record: next };
  }

  async invalidate(id: string, reason: string): Promise<MemoryMutationResult> {
    const existing = await this.read(id);
    if (existing === undefined) return { status: 'not_found' };
    const now = this.now();
    const next = withUpdated(
      existing,
      {
        lifecycle: 'invalidated',
        evidence: [...existing.evidence, { kind: 'user', ref: reason, state: 'changed', observedAt: now }],
      },
      now,
    );
    if (!(await this.commit([{ op: 'set', key: recordKey(id), value: next }]))) {
      return { status: 'failed', reason: 'invalidation was not durable' };
    }
    return { status: 'updated', record: next };
  }

  async delete(id: string, reason: string): Promise<MemoryMutationResult> {
    const existing = await this.read(id);
    if (existing === undefined) return { status: 'not_found' };
    const ops: MemoryStoreOp[] = referenceKeys(existing).map((key) => ({ op: 'del' as const, key }));
    if (!(await this.commit(ops))) return { status: 'failed', reason: 'deletion was not durable' };
    this.log.info('memory deleted', { memoryId: id, reason });
    return { status: 'updated', record: withUpdated(existing, { lifecycle: 'deleted' }, this.now()) };
  }

  async promote(request: MemoryPromotionRequest): Promise<MemoryMutationResult> {
    const existing = await this.read(request.id);
    if (existing === undefined) return { status: 'not_found' };
    const now = this.now();
    const decision = evaluatePromotion(existing, request.to, request.origin, {
      at: now,
      authority: request.authority,
      evidence: request.evidence,
    });
    if (!decision.allowed) {
      this.log.info('memory promotion rejected', {
        memoryId: existing.id,
        from: existing.trust,
        to: request.to,
        reason: decision.reason,
      });
      return { status: 'rejected', reason: decision.reason };
    }
    const next = withUpdated(
      existing,
      {
        trust: request.to,
        trustReason: decision.reason,
        evidence: request.evidence ?? existing.evidence,
        verification:
          request.to === 'verified'
            ? { status: 'verified' as const, checkedAt: now, method: 'evidence' as const }
            : existing.verification,
      },
      now,
    );
    if (!(await this.commit([{ op: 'set', key: recordKey(existing.id), value: next }]))) {
      return { status: 'failed', reason: 'promotion was not durable' };
    }
    this.log.info('memory promoted', {
      memoryId: existing.id,
      from: existing.trust,
      to: request.to,
      reason: decision.reason,
    });
    return { status: 'updated', record: next };
  }

  async approveCanonical(request: MemoryApprovalRequest): Promise<MemoryMutationResult> {
    const existing = await this.read(request.id);
    if (existing === undefined) return { status: 'not_found' };
    const now = this.now();
    const approval = { by: request.by, at: now, reason: request.reason } as const;
    const authority = resolveMemoryAuthority(request.authority);
    const targetTrust = authority === undefined ? existing.trust : ('system' as const);
    const decision = evaluatePromotion(existing, targetTrust, request.by === 'user' ? 'user' : 'application', {
      at: now,
      authority: request.authority,
      evidence: existing.evidence,
    });
    if (!decision.allowed) return { status: 'rejected', reason: decision.reason };
    const violations = checkTierAdmission({
      tier: 'canonical',
      category: existing.category,
      origin: existing.origin,
      trust: targetTrust,
      authority: request.authority,
      approval,
    });
    if (violations.length > 0) return { status: 'rejected', reason: violations[0]?.message, violations };

    const next = withUpdated(
      existing,
      { tier: 'canonical' as const, approval, trust: targetTrust, trustReason: decision.reason },
      now,
    );
    if (!(await this.commit([{ op: 'set', key: recordKey(existing.id), value: next }]))) {
      return { status: 'failed', reason: 'approval was not durable' };
    }
    this.log.info('memory approved as canonical', {
      memoryId: existing.id,
      category: existing.category,
      by: approval.by,
    });
    return { status: 'updated', record: next };
  }

  async noteAccess(ids: readonly string[], at: number): Promise<number> {
    if (!this.available() || ids.length === 0) return 0;
    let updated = 0;
    for (const id of ids) {
      const existing = await this.read(id);
      if (existing === undefined || existing.lifecycle !== 'active') continue;
      const next = { ...existing, accessCount: existing.accessCount + 1, lastAccessedAt: at };
      if (await this.commit([{ op: 'set', key: recordKey(id), value: next }])) updated += 1;
    }
    return updated;
  }

  async recordPhrase(scope: MemoryScope, ngram: string): Promise<void> {
    if (!this.available()) return;
    const scopeKey = scopeKeyFor(scope);
    if (scopeKey === undefined) return;
    const key = `${PHRASE_PREFIX}${scopeKey}:${encodeURIComponent(ngram)}`;
    const existing = await this.store.get(key);
    const now = this.now();
    const count =
      typeof existing === 'object' && existing !== null && typeof (existing as Record<string, unknown>)['count'] === 'number'
        ? ((existing as Record<string, unknown>)['count'] as number) + 1
        : 1;
    await this.store.commit([{ op: 'set', key, value: { ngram, count, lastSeenAt: now } }]);
  }

  async topPhrases(
    scope: MemoryScope,
    limit: number,
  ): Promise<readonly { readonly ngram: string; readonly count: number; readonly lastSeenAt: number }[]> {
    if (!this.available()) return [];
    const scopeKey = scopeKeyFor(scope);
    if (scopeKey === undefined) return [];
    const prefix = `${PHRASE_PREFIX}${scopeKey}:`;
    const keys = await this.store.prefixKeys(prefix, 1000);
    const values = await this.store.getMany(keys);
    const out: { ngram: string; count: number; lastSeenAt: number }[] = [];
    for (const value of values.values()) {
      if (typeof value !== 'object' || value === null) continue;
      const rec = value as Record<string, unknown>;
      if (typeof rec['ngram'] !== 'string' || typeof rec['count'] !== 'number' || typeof rec['lastSeenAt'] !== 'number') continue;
      out.push({ ngram: rec['ngram'], count: rec['count'], lastSeenAt: rec['lastSeenAt'] });
    }
    return out.toSorted((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt).slice(0, Math.max(0, limit));
  }

  async resetAccessCount(id: string): Promise<MemoryMutationResult> {
    const existing = await this.read(id);
    if (existing === undefined) return { status: 'not_found' };
    const next = { ...existing, accessCount: 0, lastAccessedAt: undefined };
    if (!(await this.commit([{ op: 'set', key: recordKey(id), value: next }]))) {
      return { status: 'failed', reason: 'reset was not durable' };
    }
    return { status: 'updated', record: next };
  }

  async expireDue(now: number): Promise<readonly MemoryRecord[]> {
    if (!this.available()) return [];
    const expired: MemoryRecord[] = [];
    for (const tier of MEMORY_TIERS) {
      const records = await this.listAll({ tiers: [tier], lifecycle: ['active'], limit: 1000 });
      for (const record of records) {
        if (record.expiresAt === undefined || record.expiresAt > now) continue;
        const next = withUpdated(record, { lifecycle: 'expired' satisfies MemoryLifecycle }, now);
        if (await this.commit([{ op: 'set', key: recordKey(record.id), value: next }])) expired.push(next);
      }
    }
    return expired;
  }

  async purgeWorking(olderThan: number): Promise<readonly string[]> {
    if (!this.available()) return [];
    const purged: string[] = [];
    const records = await this.listAll({
      tiers: ['working'],
      lifecycle: ['expired', 'invalidated', 'deleted'],
      limit: 1000,
    });
    for (const record of records) {
      if (record.updatedAt > olderThan) continue;
      if (await this.commit(referenceKeys(record).map((key) => ({ op: 'del' as const, key })))) {
        purged.push(record.id);
      }
    }
    return purged;
  }

  async saveTaskState(input: MemoryTaskStateInput): Promise<MemoryCaptureResult> {
    const state: MemoryTaskState = input;
    const content = renderTaskState(state);
    const now = this.now();
    const expiresAt = input.ttlMs === undefined ? now + this.settings.workingTtlMs : now + input.ttlMs;
    const subject = `${TASK_STATE_SUBJECT_PREFIX}${input.taskId}`;
    const existing = (await this.findBySubject(subject, input.scope))[0];
    if (existing !== undefined && existing.lifecycle === 'active') {
      const next = withUpdated(
        existing,
        { content, evidence: input.evidence ?? existing.evidence, expiresAt, scope: input.scope },
        now,
      );
      if (!(await this.commit([{ op: 'set', key: recordKey(existing.id), value: next }]))) {
        return { status: 'rejected', reason: 'task state could not be stored' };
      }
      return { status: 'stored', id: existing.id, record: next };
    }
    return this.capture({
      content,
      tier: 'working',
      category: 'task',
      sourceType: 'agent_observation',
      origin: 'application',
      scope: input.scope,
      subject,
      evidence: input.evidence,
      expiresAt,
      requestKey: `task-state:${input.taskId}`,
    });
  }

  async restoreTaskState(input: MemoryTaskStateInput): Promise<MemoryTaskRestore> {
    if (!this.available()) return { status: 'unavailable', reason: 'memory is unavailable' };
    const found = (await this.findBySubject(`${TASK_STATE_SUBJECT_PREFIX}${input.taskId}`, input.scope))[0];
    if (found === undefined) return { status: 'missing', reason: 'no stored task state for this task' };
    if (found.lifecycle !== 'active') {
      return { status: 'missing', record: found, reason: `stored task state is ${found.lifecycle}` };
    }
    const now = this.now();
    if (found.expiresAt !== undefined && found.expiresAt <= now) {
      return { status: 'missing', record: found, reason: 'stored task state has expired' };
    }
    const staleEvidence = found.evidence
      .filter((item) => item.state !== 'present')
      .map((item) => ({ ref: item.ref, reason: `evidence is ${item.state}` }));
    return {
      status: staleEvidence.length > 0 ? 'stale' : 'restored',
      record: found,
      staleEvidence,
    };
  }

  async markStale(
    fingerprints: ReadonlyMap<string, string>,
    options: { readonly projectId?: string; readonly tiers?: readonly MemoryTier[] },
  ): Promise<MemoryStaleReport> {
    if (!this.available()) return { status: 'unavailable', checked: 0, marked: 0, findings: [] };
    const candidates = await this.listAll({
      tiers: options.tiers ?? MEMORY_TIERS,
      lifecycle: ['active'],
      limit: 5000,
    });
    const records =
      options.projectId === undefined
        ? candidates
        : candidates.filter((record) => record.scope.projectId === options.projectId);
    const findings: MemoryStaleFinding[] = [];
    const now = this.now();
    let checked = 0;
    for (const record of records) {
      const outcome = reconcileEvidence(record, fingerprints, now);
      checked += outcome.checked;
      if (!outcome.changed) continue;
      findings.push(...outcome.findings);
      const next = withUpdated(
        record,
        {
          evidence: outcome.evidence,
          verification: { status: 'unverified' as const, method: 'none' as const },
          trust: record.trust === 'system' ? record.trust : ('unverified' as const),
          trustReason: 'evidence changed since capture',
        },
        now,
      );
      if (await this.commit([{ op: 'set', key: recordKey(record.id), value: next }])) {
        this.log.info('memory marked stale', {
          memoryId: record.id,
          evidenceRefs: outcome.findings.length,
        });
      }
    }
    return { status: 'checked', checked, marked: new Set(findings.map((finding) => finding.memoryId)).size, findings };
  }

  async citedFileRefs(limit: number): Promise<readonly string[]> {
    if (!this.available()) return [];
    const records = await this.listAll({
      tiers: MEMORY_TIERS,
      lifecycle: ['active'],
      limit: Math.max(1, limit),
    });
    const refs = new Set<string>();
    for (const record of records) {
      for (const item of record.evidence) {
        if (item.kind !== 'file' || item.fingerprint === undefined) continue;
        refs.add(item.ref);
      }
    }
    return [...refs];
  }

  async refreshEvidence(
    options: MemoryEvidenceRefreshOptions = {},
  ): Promise<MemoryEvidenceRefreshReport> {
    const unavailable: MemoryEvidenceRefreshReport = {
      status: 'unavailable',
      checked: 0,
      changed: 0,
      unreadable: 0,
      report: { status: 'unavailable', checked: 0, marked: 0, findings: [] },
    };
    if (this.readEvidence === undefined || !this.available()) return unavailable;
    const limit = Math.max(1, options.limit ?? 200);
    const records = await this.listAll({ tiers: MEMORY_TIERS, lifecycle: ['active'], limit: limit * 4 });
    const scoped =
      options.projectId === undefined
        ? records
        : records.filter((record) => record.scope.projectId === options.projectId);
    const observed = new Map<string, string>();
    let checked = 0;
    let unreadable = 0;
    let budget = limit;
    for (const record of scoped) {
      if (budget <= 0) break;
      for (const item of record.evidence) {
        if (budget <= 0) break;
        if (item.fingerprint === undefined || !isFingerprintOfKind(item.fingerprint, item.kind)) continue;
        if (observed.has(item.ref)) continue;
        budget -= 1;
        let content: string | undefined;
        try {
          content = await this.readEvidence(item.ref);
        } catch {
          content = undefined;
        }
        if (content === undefined) {
          unreadable += 1;
          continue;
        }
        checked += 1;
        const current = fingerprintText(content);
        if (current !== item.fingerprint) observed.set(item.ref, current);
      }
    }
    const report = await this.markStale(observed, {
      projectId: options.projectId,
      tiers: MEMORY_TIERS,
    });
    return { status: 'checked', checked, changed: observed.size, unreadable, report };
  }

  async runReview(limit: number): Promise<MemoryReviewReport> {
    const jobs: MemoryReviewJobReport[] = [];
    let stored = 0;
    let deduplicated = 0;
    let skipped = 0;
    let retrying = 0;
    let failed = 0;
    if (!this.available()) return { processed: 0, stored, deduplicated, skipped, retrying, failed, jobs };
    const now = this.now();
    for (const job of await this.pendingReviews(now, limit)) {
      const report = await this.processReviewJob(job, now);
      jobs.push(report);
      if (report.status === 'done') {
        if (report.reason === 'deduplicated') deduplicated += 1;
        else stored += 1;
      } else if (report.status === 'failed') failed += 1;
      else if (report.status === 'retrying') retrying += 1;
      else skipped += 1;
    }
    return { processed: jobs.length, stored, deduplicated, skipped, retrying, failed, jobs };
  }

  async pendingReviews(now: number, limit: number): Promise<readonly MemoryReviewJob[]> {
    if (!this.available()) return [];
    let keys: readonly string[];
    try {
      keys = await this.store.prefixKeys(REVIEW_PREFIX, Math.max(1, limit));
    } catch (error) {
      this.recordFailure('pendingReviews', error);
      return [];
    }
    const jobs: MemoryReviewJob[] = [];
    for (const value of (await this.store.getMany(keys)).values()) {
      const job = asReviewJob(value);
      if (job === undefined) continue;
      if (job.status !== 'pending') continue;
      if (job.nextAttemptAt > now) continue;
      jobs.push(job);
    }
    jobs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return jobs.slice(0, Math.max(1, limit));
  }

  async diagnostics(): Promise<MemoryDiagnostics> {
    const counts = { working: 0, distilled: 0, canonical: 0 } as Record<(typeof MEMORY_TIERS)[number], number>;
    const lifecycleCounts = Object.fromEntries(MEMORY_LIFECYCLES.map((value) => [value, 0])) as Record<
      MemoryLifecycle,
      number
    >;
    let pendingReviews = 0;
    let failedReviews = 0;
    let status: MemoryDiagnostics['status'] = 'ok';
    try {
      for (const tier of MEMORY_TIERS) {
        const records = await this.listAll({ tiers: [tier], limit: 1000 });
        counts[tier] = records.length;
        for (const record of records) lifecycleCounts[record.lifecycle] += 1;
      }
      for (const value of (await this.store.getMany(await this.store.prefixKeys(REVIEW_PREFIX, 1000))).values()) {
        const job = asReviewJob(value);
        if (job === undefined) continue;
        if (job.status === 'pending') pendingReviews += 1;
        if (job.status === 'failed') failedReviews += 1;
      }
    } catch (error) {
      status = 'unavailable';
      this.recordFailure('diagnostics', error);
    }
    let textIndex: MemoryDiagnostics['textIndex'] = 'absent';
    try {
      textIndex = await this.store.textIndexState();
    } catch {
      textIndex = 'absent';
    }
    const readOnly = this.store.readOnly === true;
    if (status === 'ok' && this.lastError !== undefined) status = 'degraded';
    return {
      status,
      storeDir: this.settings.dir,
      schemaVersion: MEMORY_SCHEMA_VERSION,
      textIndex,
      readOnly,
      counts,
      lifecycleCounts,
      pendingReviews,
      failedReviews,
      lastError: this.lastError,
    };
  }

  private async enqueueReview(input: MemoryCaptureInput, now: number): Promise<MemoryCaptureResult> {
    const queued = await this.store.prefixKeys(REVIEW_PREFIX, this.settings.maxQueuedReviews + 1);
    if (queued.length >= this.settings.maxQueuedReviews) {
      return { status: 'rejected', reason: 'memory review queue is full' };
    }
    const job: MemoryReviewJob = {
      id: this.newId(),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
      input,
    };
    if (!(await this.commit([{ op: 'set', key: reviewKey(job.id), value: job }]))) {
      return { status: 'rejected', reason: 'memory review could not be queued' };
    }
    return { status: 'queued', id: job.id };
  }

  private async processReviewJob(job: MemoryReviewJob, now: number): Promise<MemoryReviewJobReport> {
    const attempts = job.attempts + 1;
    try {
      const result = await this.capture({ ...job.input, review: 'immediate' });
      if (result.status === 'failed') throw new MemoryError(MemoryErrors.codes.REVIEW_FAILED, result.reason ?? 'review failed');
      const status = result.status === 'stored' || result.status === 'deduplicated' ? 'done' : 'skipped';
      const finished: MemoryReviewJob = {
        ...job,
        status,
        attempts,
        updatedAt: now,
        memoryId: result.id,
        reason: result.status,
      };
      await this.commit([{ op: 'set', key: reviewKey(job.id), value: finished }]);
      return { jobId: job.id, status, attempts, memoryId: result.id, reason: result.status };
    } catch (error) {
      this.recordFailure('processReviewJob', error);
      const exhausted = attempts >= this.settings.reviewMaxAttempts;
      const message = error instanceof Error ? error.message : String(error);
      const next: MemoryReviewJob = {
        ...job,
        status: exhausted ? 'failed' : 'pending',
        attempts,
        updatedAt: now,
        nextAttemptAt: now + this.settings.reviewBackoffMs * attempts,
        lastError: message,
      };
      await this.commit([{ op: 'set', key: reviewKey(job.id), value: next }]);
      return { jobId: job.id, status: exhausted ? 'failed' : 'retrying', attempts, reason: message };
    }
  }

  private async resolveConflicts(
    record: MemoryRecord,
    now: number,
  ): Promise<{ status: 'ok'; record: MemoryRecord; siblings: MemoryRecord[] } | { status: 'rejected'; reason: string }> {
    if (record.subject === undefined) return { status: 'ok', record, siblings: [] };
    const siblings: MemoryRecord[] = [];
    for (const sibling of await this.findBySubject(record.subject, record.scope)) {
      if (sibling.id === record.id || sibling.lifecycle !== 'active') continue;
      siblings.push(sibling);
    }
    if (siblings.length === 0) return { status: 'ok', record, siblings: [] };

    const conflictsWith = new Set(record.conflictsWith);
    let next = record;
    for (const sibling of siblings) {
      conflictsWith.add(sibling.id);
      const outranks =
        record.origin !== 'model' &&
        (TRUST_RANK[record.trust] > TRUST_RANK[sibling.trust] ||
          (record.sourceType === 'user_correction' && sibling.sourceType !== 'user_correction'));
      if (outranks) {
        siblings[siblings.indexOf(sibling)] = withUpdated(
          sibling,
          {
            lifecycle: 'superseded' satisfies MemoryLifecycle,
            supersededBy: next.id,
            conflictsWith: [...sibling.conflictsWith, next.id],
          },
          now,
        );
        if (next.supersedes === undefined) next = withUpdated(next, { supersedes: sibling.id }, now);
      } else {
        siblings[siblings.indexOf(sibling)] = withUpdated(
          sibling,
          { conflictsWith: [...sibling.conflictsWith, next.id] },
          now,
        );
      }
    }
    return { status: 'ok', record: withUpdated(next, { conflictsWith: [...conflictsWith] }, now), siblings };
  }

  private async findBySubject(subject: string, scope: MemoryScope): Promise<MemoryRecord[]> {
    const prefix = subjectPrefixFor(subject, scope);
    if (prefix === undefined) return [];
    const pointers = await this.store.prefixKeys(prefix, 50);
    const ids = pointerIds((await this.store.getMany(pointers)).values());
    const found: MemoryRecord[] = [];
    for (const value of (await this.store.getMany(ids.map(recordKey))).values()) {
      const record = parseMemoryRecord(value);
      if (record !== undefined && record.subject === subject) found.push(record);
    }
    return found;
  }

  private async findDuplicate(record: MemoryRecord): Promise<MemoryRecord | undefined> {
    const raw = await this.store.get(fingerprintKey(record.fingerprint));
    if (typeof raw !== 'object' || raw === null) return undefined;
    const id = (raw as Record<string, unknown>)['id'];
    if (typeof id !== 'string') return undefined;
    const existing = await this.read(id);
    return existing !== undefined && existing.lifecycle === 'active' ? existing : undefined;
  }

  private async missingSources(ids: readonly string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const id of ids) {
      if (await this.read(id) === undefined) missing.push(id);
    }
    return missing;
  }

  private async resolveIdempotent(
    requestKey: string,
  ): Promise<{ id: string; record: MemoryRecord } | undefined> {
    const raw = await this.store.get(idempotencyKey(requestKey));
    if (typeof raw !== 'object' || raw === null) return undefined;
    const id = (raw as Record<string, unknown>)['id'];
    if (typeof id !== 'string') return undefined;
    const record = await this.read(id);
    return record === undefined ? undefined : { id, record };
  }

  private async read(id: string): Promise<MemoryRecord | undefined> {
    if (!this.available()) return undefined;
    try {
      return parseMemoryRecord(await this.store.get(recordKey(id)));
    } catch (error) {
      this.recordFailure('read', error);
      return undefined;
    }
  }

  private async commit(ops: readonly MemoryStoreOp[]): Promise<boolean> {
    if (ops.length === 0) return true;
    try {
      await this.store.commit(ops);
      return true;
    } catch (error) {
      this.recordFailure('commit', error);
      return false;
    }
  }

  private async listAll(query: Omit<MemoryListQuery, 'workspaceId' | 'projectId' | 'sessionId' | 'taskId'>): Promise<MemoryRecord[]> {
    const limit = Math.max(1, query.limit ?? 1000);
    const found: MemoryRecord[] = [];
    for (const value of (await this.store.getMany(
      (await this.scopePointerKeys(ALL_SCOPE_PREFIXES, limit)).map(recordKey),
    )).values()) {
      const record = parseMemoryRecord(value);
      if (record === undefined) continue;
      if (query.tiers !== undefined && !query.tiers.includes(record.tier)) continue;
      if (query.categories !== undefined && !query.categories.includes(record.category)) continue;
      if (query.lifecycle !== undefined && !query.lifecycle.includes(record.lifecycle)) continue;
      found.push(record);
    }
    return found;
  }

  private async scopePointerKeys(prefixes: readonly string[], limit: number): Promise<string[]> {
    const keys: string[] = [];
    for (const prefix of prefixes) {
      const remaining = limit - keys.length;
      if (remaining <= 0) break;
      keys.push(...(await this.store.prefixKeys(prefix, remaining)));
    }
    return pointerIds((await this.store.getMany(keys)).values());
  }

  private listPrefixes(query: MemoryListQuery): readonly string[] {
    const prefixes: string[] = [];
    const tiers = query.scopes ?? ['global', 'workspace', 'repository', 'session', 'task'];
    for (const tier of tiers) {
      const resolved =
        tier === 'global'
          ? ({ tier } as const)
          : tier === 'workspace'
            ? ({ tier, workspaceId: query.workspaceId } as const)
            : tier === 'repository'
              ? ({ tier, projectId: query.projectId } as const)
              : tier === 'session'
                ? ({ tier, sessionId: query.sessionId } as const)
                : ({ tier, taskId: query.taskId } as const);
      const prefix = scopePrefix(resolved);
      if (prefix !== undefined) prefixes.push(prefix);
    }
    return prefixes;
  }

  private recordFailure(operation: string, error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.log.warn('memory operation failed', {
      operation,
      code: error instanceof MemoryError ? error.code : undefined,
      error: this.lastError,
    });
  }
}

interface StaleReconciliation {
  readonly changed: boolean;
  readonly checked: number;
  readonly evidence: MemoryRecord['evidence'];
  readonly findings: readonly MemoryStaleFinding[];
}

function reconcileEvidence(
  record: MemoryRecord,
  fingerprints: ReadonlyMap<string, string>,
  now: number,
): StaleReconciliation {
  const findings: MemoryStaleFinding[] = [];
  let checked = 0;
  let changed = false;
  const evidence = record.evidence.map((item) => {
    if (item.fingerprint === undefined) return item;
    const observed = fingerprints.get(item.ref);
    if (observed === undefined) return item;
    checked += 1;
    if (observed === item.fingerprint) return item;
    changed = true;
    findings.push({
      memoryId: record.id,
      evidenceRef: item.ref,
      previousFingerprint: item.fingerprint,
      observedFingerprint: observed,
    });
    return { ...item, state: 'changed' as const, observedAt: now };
  });
  return { changed, checked, evidence, findings };
}

function renderTaskState(state: MemoryTaskState): string {
  const lines = [`Task: ${state.objective}`];
  const section = (title: string, values: readonly string[]) => {
    if (values.length === 0) return;
    lines.push(`${title}:`);
    for (const value of values) lines.push(`- ${value}`);
  };
  section('Completed', state.completed);
  section('Active', state.active ?? []);
  section('Decisions', state.decisions);
  section('Failed attempts', state.failedAttempts);
  section('Blockers', state.blockers);
  section('Files', state.fileRefs);
  if (state.nextAction !== undefined) lines.push(`Next: ${state.nextAction}`);
  return lines.join('\n');
}

function asReviewJob(value: unknown): MemoryReviewJob | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const job = value as Partial<MemoryReviewJob>;
  if (typeof job.id !== 'string' || typeof job.input !== 'object' || job.input === null) return undefined;
  if (job.status === undefined || typeof job.attempts !== 'number' || typeof job.nextAttemptAt !== 'number') {
    return undefined;
  }
  return job as MemoryReviewJob;
}