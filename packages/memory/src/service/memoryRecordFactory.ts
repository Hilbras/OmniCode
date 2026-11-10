import { createHash } from 'node:crypto';

import type { MemoryAuthority } from '#/contracts/memoryAuthority';
import type { MemoryApproval, MemoryEvidence, MemoryRecord, MemoryScope } from '#/contracts/memoryTypes';

import { redactMemoryContent } from '#/security/redaction';
import { analyzeMemoryContent } from '#/security/suspicion';
import { type TrustEvaluation, evaluateInitialTrust } from '#/trust/trustPolicy';

import { searchTextFor } from '#/retrieval/stem';
import { fingerprintKey, scopeKeyFor } from '#/storage/memoryKeys';

export function hashContent(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

function normalizeForFingerprint(content: string): string {
  return content.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();
}

function fingerprintFor(input: {
  readonly content: string;
  readonly scope: MemoryScope;
  readonly tier: MemoryRecord['tier'];
  readonly category: MemoryRecord['category'];
}): string | undefined {
  const scopeKey = scopeKeyFor(input.scope);
  if (scopeKey === undefined) return undefined;
  return hashContent(
    [input.tier, input.category, scopeKey, normalizeForFingerprint(input.content)].join('\n'),
  );
}

export interface RecordDraft {
  readonly content: string;
  readonly tier: MemoryRecord['tier'];
  readonly category: MemoryRecord['category'];
  readonly sourceType: MemoryRecord['sourceType'];
  readonly origin: MemoryRecord['origin'];
  readonly scope: MemoryScope;
  readonly subject?: string;
  readonly evidence?: readonly MemoryEvidence[];
  readonly derivedFrom?: readonly string[];
  readonly authority?: MemoryAuthority;
  readonly approval?: MemoryApproval;
  readonly repoRevision?: string;
  readonly expiresAt?: number;
}

export interface BuiltRecord {
  readonly record: MemoryRecord;
  readonly fingerprint?: string;
  readonly fingerprintKey?: string;
}

export function buildRecord(draft: RecordDraft, id: string, now: number): BuiltRecord {
  const redaction = redactMemoryContent(draft.content);
  const suspicion = analyzeMemoryContent(redaction.content);
  const evidence = [...(draft.evidence ?? [])];
  const trust: TrustEvaluation = evaluateInitialTrust(
    {
      sourceType: draft.sourceType,
      origin: draft.origin,
      evidence,
      authority: draft.authority,
    },
    now,
  );
  const fingerprint = fingerprintFor({
    content: redaction.content,
    scope: draft.scope,
    tier: draft.tier,
    category: draft.category,
  });

  const record: MemoryRecord = {
    id,
    tier: draft.tier,
    category: draft.category,
    content: redaction.content,
    searchText: searchTextFor(redaction.content),
    redactionCount: redaction.redactionCount,
    trust: trust.trust,
    trustReason: trust.reason,
    sourceType: draft.sourceType,
    origin: draft.origin,
    scope: draft.scope,
    createdAt: now,
    updatedAt: now,
    lifecycle: 'active',
    evidence,
    derivedFrom: [...(draft.derivedFrom ?? [])],
    expiresAt: draft.expiresAt,
    revision: 0,
    accessCount: 0,
    fingerprint: fingerprint ?? hashContent(`${id}:${now}`),
    verification: trust.verification,
    conflictsWith: [],
    suspicious: suspicion.suspicious,
    suspicionReasons: [...suspicion.reasons],
    subject: draft.subject,
    approval: draft.approval,
    repoRevision: draft.repoRevision,
  };

  return {
    record,
    fingerprint,
    fingerprintKey: fingerprint === undefined ? undefined : fingerprintKey(fingerprint),
  };
}

export type MemoryRecordPatch = Omit<Partial<MemoryRecord>, 'evidence'> & {
  readonly evidence?: readonly MemoryEvidence[];
};

export function withUpdated(record: MemoryRecord, patch: MemoryRecordPatch, now: number): MemoryRecord {
  return { ...record, ...(patch as Partial<MemoryRecord>), updatedAt: now, revision: record.revision + 1 };
}