import { MemoryError, MemoryErrors } from '#/contracts/errors';
import type { MemorySearchQuery, RetrievalResult } from '#/contracts/memoryContract';
import type { MemoryRecord } from '#/contracts/memoryTypes';
import { MEMORY_SCOPE_TIERS, parseMemoryRecord, TRUST_RANK } from '#/contracts/memoryTypes';
import {
  type BudgetConstraint,
  RETRIEVAL_NOTICE_INCOMPLETE,
  type RetrievalBudget,
  type RetrievedMemory,
  type RetrievalGateDecision,
  type RetrievalPurpose,
  type RetrievalStatus,
} from '#/contracts/retrieval';

import { pointerIds, recordKey, scopePrefix } from '#/storage/memoryKeys';
import type { MemoryStorePort } from '#/storage/memoryStore';

import { applyBudget, CONTEXT_HEADER, resolveBudget } from './budget';
import { normalizeQuery } from './normalize';
import { composeScore, normalizeLexical } from './ranking';

const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'did', 'do', 'does', 'for', 'from', 'had',
  'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your',
]);

export interface MemoryRetrieverOptions {
  readonly store: MemoryStorePort;
  readonly now: () => number;
}

export class MemoryRetriever {
  constructor(private readonly options: MemoryRetrieverOptions) {}

  async search(query: MemorySearchQuery): Promise<RetrievalResult> {
    const purpose: RetrievalPurpose = query.purpose ?? 'explicit_search';
    const resolved = resolveBudget(purpose, query.budget, query.limit);
    const normalized = normalizeQuery(query.query);
    const significantTerms = normalized.terms.filter((term) => !STOPWORDS.has(term));
    const indexQuery = significantTerms.length > 0 ? significantTerms.join(' ') : normalized.text;

    const diagnostics: MutableDiagnostics = {
      normalizedQuery: normalized.text,
      queryTerms: significantTerms,
      scopePrefixes: [],
      scopeCandidates: 0,
      lexicalCandidates: 0,
      lexicalTruncated: false,
      lexicalVisits: 0,
      rejected: [],
    };
    const constraints: BudgetConstraint[] = [];

    try {
      const prefixes = this.scopePrefixes(query);
      diagnostics.scopePrefixes = prefixes;
      const scopeKeys = await this.collectScopeCandidates(prefixes, resolved.budget.maxCandidates);
      diagnostics.scopeCandidates = scopeKeys.keys.size;
      if (scopeKeys.truncated) constraints.push('scope_candidates');

      const candidates =
        scopeKeys.keys.size === 0
          ? []
          : await this.candidates(scopeKeys.keys, indexQuery, resolved.budget, constraints, diagnostics);
      diagnostics.lexicalCandidates = candidates.length;
      if (candidates.length >= resolved.budget.maxCandidates) constraints.push('maxCandidates');

      const records = await this.loadRecords(
        candidates.map((candidate) => candidate.key),
        diagnostics,
      );
      const scoreByKey = new Map<string, number>();
      for (const candidate of candidates) scoreByKey.set(candidate.key, candidate.score);

      const eligible: { record: MemoryRecord; lexical: number; gates: RetrievalGateDecision[] }[] = [];
      for (const [key, record] of records) {
        const gates = this.evaluateGates(record, prefixes, query);
        const blocked = gates.filter((gate) => !gate.allowed);
        if (blocked.length > 0) {
          diagnostics.rejected.push(...blocked);
          continue;
        }
        eligible.push({ record, lexical: scoreByKey.get(key) ?? 0, gates: [...gates] });
      }

      const lexicalByRecord = new Map<MemoryRecord, number>();
      for (const entry of eligible) lexicalByRecord.set(entry.record, entry.lexical);
      const normalizedScores = normalizeLexical([...lexicalByRecord.values()]);

      const ranked: RetrievedMemory[] = eligible.map((entry) => {
        const components = composeScore({
          lexical: normalizedScores.get(entry.lexical) ?? 0,
          trust: entry.record.trust,
          scope: entry.record.scope.tier,
          accessCount: entry.record.accessCount,
        });
        return { record: entry.record, explanation: this.explain(entry, components) };
      });

      ranked.sort((a, b) => {
        if (b.explanation.score !== a.explanation.score) return b.explanation.score - a.explanation.score;
        if (a.record.updatedAt !== b.record.updatedAt) return b.record.updatedAt - a.record.updatedAt;
        return a.record.id.localeCompare(b.record.id);
      });

      const applied = applyBudget({
        budget: resolved.budget,
        ranked,
        constraints,
        lexicalTruncated: diagnostics.lexicalTruncated,
        scopeCandidatesTruncated: constraints.includes('scope_candidates'),
      });

      const status: RetrievalStatus = applied.report.truncated
        ? 'partial'
        : applied.memories.length === 0
          ? 'no_match'
          : 'complete';
      return {
        status,
        query: normalized.text,
        purpose,
        memories: applied.memories,
        budget: applied.report,
        diagnostics,
        context: applied.memories.length === 0 ? '' : `${CONTEXT_HEADER}\n\n${applied.context}`,
        notice: status === 'partial' ? RETRIEVAL_NOTICE_INCOMPLETE : undefined,
      };
    } catch (error) {
      const unavailable = error instanceof MemoryError && error.code === MemoryErrors.codes.STORAGE_UNAVAILABLE;
      return failedResult(
        normalized.text,
        purpose,
        resolved.budget,
        diagnostics,
        unavailable ? 'unavailable' : 'failed',
      );
    }
  }

  private explain(
    entry: { record: MemoryRecord; gates: readonly RetrievalGateDecision[] },
    components: ReturnType<typeof composeScore>,
  ): RetrievedMemory['explanation'] {
    const record = entry.record;
    return {
      memoryId: record.id,
      tier: record.tier,
      category: record.category,
      trust: record.trust,
      sourceType: record.sourceType,
      scopeTier: record.scope.tier,
      lifecycle: record.lifecycle,
      score: components.total,
      components,
      gates: entry.gates,
      evidence: record.evidence,
      suspicious: record.suspicious,
      suspiciousReasons: record.suspicionReasons,
      redacted: record.redactionCount > 0,
      conflictsWith: record.conflictsWith,
    };
  }

  private async candidates(
    scopeKeys: ReadonlySet<string>,
    indexQuery: string,
    budget: { maxCandidates: number; maxPostingsVisits: number },
    constraints: BudgetConstraint[],
    diagnostics: MutableDiagnostics,
  ): Promise<{ key: string; score: number }[]> {
    const indexState = await this.options.store.textIndexState();
    if (indexState === 'building') {
      constraints.push('text_index_building');
      diagnostics.lexicalTruncated = true;
      return this.literalCandidates(scopeKeys, budget.maxCandidates);
    }
    if (indexQuery.length === 0) {
      return this.literalCandidates(scopeKeys, budget.maxCandidates);
    }
    const result = await this.options.store.searchText({
      query: indexQuery,
      op: 'OR',
      limit: budget.maxCandidates,
      maxVisits: budget.maxPostingsVisits,
      allowedKeys: scopeKeys,
    });
    diagnostics.lexicalTruncated = result.truncated;
    diagnostics.lexicalVisits = result.visits;
    if (result.truncated) constraints.push('text_index_building');
    return result.hits.map((hit) => ({ key: hit.key, score: hit.score }));
  }

  private async literalCandidates(scopeKeys: ReadonlySet<string>, limit: number) {
    const found = await this.options.store.getMany([...scopeKeys]);
    const candidates: { key: string; score: number }[] = [];
    for (const [key, value] of found) {
      if (parseMemoryRecord(value) === undefined) continue;
      candidates.push({ key, score: 1 });
      if (candidates.length >= limit) break;
    }
    return candidates;
  }

  private statusFor(truncated: boolean, count: number): RetrievalStatus {
    return truncated ? 'partial' : count === 0 ? 'no_match' : 'complete';
  }

  private scopePrefixes(query: MemorySearchQuery): readonly string[] {
    const allowed = query.scopes ?? MEMORY_SCOPE_TIERS;
    const prefixes: string[] = [];
    if (allowed.includes('global')) prefixes.push(scopePrefix({ tier: 'global' }) ?? 's:g:');
    if (allowed.includes('workspace') && query.workspaceId !== undefined) {
      const prefix = scopePrefix({ tier: 'workspace', workspaceId: query.workspaceId });
      if (prefix !== undefined) prefixes.push(prefix);
    }
    if (allowed.includes('repository') && query.projectId !== undefined) {
      const prefix = scopePrefix({ tier: 'repository', projectId: query.projectId });
      if (prefix !== undefined) prefixes.push(prefix);
    }
    if (allowed.includes('session') && query.sessionId !== undefined) {
      const prefix = scopePrefix({ tier: 'session', sessionId: query.sessionId });
      if (prefix !== undefined) prefixes.push(prefix);
    }
    if (allowed.includes('task') && query.taskId !== undefined) {
      const prefix = scopePrefix({ tier: 'task', taskId: query.taskId });
      if (prefix !== undefined) prefixes.push(prefix);
    }
    return prefixes;
  }

  private async collectScopeCandidates(
    prefixes: readonly string[],
    limit: number,
  ): Promise<{ keys: Set<string>; truncated: boolean }> {
    const keys = new Set<string>();
    let truncated = false;
    for (const prefix of prefixes) {
      const remaining = limit - keys.size;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const found = await this.options.store.prefixKeys(prefix, remaining + 1);
      const pointers = await this.options.store.getMany(found);
      for (const id of pointerIds(pointers.values()).slice(0, remaining)) keys.add(recordKey(id));
      if (found.length > remaining) truncated = true;
    }
    return { keys, truncated };
  }

  private async loadRecords(
    keys: readonly string[],
    diagnostics: MutableDiagnostics,
  ): Promise<ReadonlyMap<string, MemoryRecord>> {
    const found = await this.options.store.getMany(keys);
    const records = new Map<string, MemoryRecord>();
    for (const [key, value] of found) {
      const record = parseMemoryRecord(value);
      if (record === undefined) {
        diagnostics.rejected.push({ gate: 'integrity', allowed: false, detail: `unreadable record at ${key}` });
        continue;
      }
      if (recordKey(record.id) !== key) {
        diagnostics.rejected.push({ gate: 'integrity', allowed: false, detail: `record key mismatch at ${key}` });
        continue;
      }
      records.set(key, record);
    }
    return records;
  }

  private evaluateGates(
    record: MemoryRecord,
    prefixes: readonly string[],
    query: MemorySearchQuery,
  ): readonly RetrievalGateDecision[] {
    const prefix = scopePrefix(record.scope);
    const scopeAllowed = prefix !== undefined && prefixes.includes(prefix);
    const expired = record.expiresAt !== undefined && record.expiresAt <= this.options.now();
    const minTrust = query.includeUntrusted === true ? 'unverified' : (query.minTrust ?? 'trusted');
    const categories = query.categories;
    const tiers = query.tiers;
    const approvedCanonical =
      record.tier === 'canonical' && record.approval !== undefined && TRUST_RANK[record.trust] >= TRUST_RANK.trusted;

    return [
      {
        gate: 'scope',
        allowed: scopeAllowed,
        detail: scopeAllowed ? `scope ${record.scope.tier} is eligible` : `scope ${record.scope.tier} is outside the request`,
      },
      { gate: 'tier', allowed: tiers === undefined || tiers.includes(record.tier), detail: `tier ${record.tier}` },
      { gate: 'lifecycle', allowed: record.lifecycle === 'active', detail: `lifecycle ${record.lifecycle}` },
      { gate: 'expiry', allowed: !expired, detail: expired ? 'retention window elapsed' : 'within retention' },
      {
        gate: 'trust',
        allowed: TRUST_RANK[record.trust] >= TRUST_RANK[minTrust],
        detail: `trust ${record.trust} against minimum ${minTrust}`,
      },
      {
        gate: 'category',
        allowed: categories === undefined || categories.includes(record.category),
        detail: `category ${record.category}`,
      },
      {
        gate: 'suspicion',
        allowed: !record.suspicious || approvedCanonical,
        detail: record.suspicious
          ? `suspicious content: ${record.suspicionReasons.join(', ')}${approvedCanonical ? ' (explicitly approved)' : ''}`
          : 'no injection signals',
      },
    ];
  }
}

export function unavailableResult(query: MemorySearchQuery): RetrievalResult {
  const purpose = query.purpose ?? 'explicit_search';
  const normalized = normalizeQuery(query.query);
  return failedResult(normalized.text, purpose, resolveBudget(purpose, query.budget, query.limit).budget, {
    normalizedQuery: normalized.text,
    queryTerms: [],
    scopePrefixes: [],
    scopeCandidates: 0,
    lexicalCandidates: 0,
    lexicalTruncated: false,
    lexicalVisits: 0,
    rejected: [],
  }, 'unavailable');
}

function failedResult(
  normalizedText: string,
  purpose: RetrievalPurpose,
  budget: RetrievalBudget,
  diagnostics: MutableDiagnostics,
  status: 'unavailable' | 'failed',
): RetrievalResult {
  return {
    status,
    query: normalizedText,
    purpose,
    memories: [],
    budget: { applied: budget, truncated: true, constraints: [], droppedByBudget: 0, mayBeIncomplete: true },
    diagnostics,
    context: '',
    notice: RETRIEVAL_NOTICE_INCOMPLETE,
  };
}

interface MutableDiagnostics {
  normalizedQuery: string;
  queryTerms: readonly string[];
  scopePrefixes: readonly string[];
  scopeCandidates: number;
  lexicalCandidates: number;
  lexicalTruncated: boolean;
  lexicalVisits: number;
  rejected: RetrievalGateDecision[];
}

export type { RetrievalStatus };