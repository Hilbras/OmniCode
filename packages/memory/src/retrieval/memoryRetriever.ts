import { MemoryError, MemoryErrors } from '#/contracts/errors';
import type { MemorySearchQuery, RetrievalResult } from '#/contracts/memoryContract';
import type { MemoryRecord, MemorySensitivity } from '#/contracts/memoryTypes';
import { MEMORY_SCOPE_TIERS, parseMemoryRecord, SENSITIVITY_RANK, TRUST_RANK } from '#/contracts/memoryTypes';
import {
  type BudgetConstraint,
  RETRIEVAL_NOTICE_INCOMPLETE,
  type RetrievalBudget,
  type RetrievedMemory,
  type RetrievalGateDecision,
  type RetrievalPurpose,
  type RetrievalStatus,
} from '#/contracts/retrieval';

import {
  pointerIds,
  recordKey,
  relationPrefixFor,
  reverseRelationPrefixFor,
  scopePrefix,
} from '#/storage/memoryKeys';
import type { MemoryStorePort } from '#/storage/memoryStore';

import { applyBudget, CONTEXT_HEADER, resolveBudget } from './budget';
import { normalizeQuery } from './normalize';
import { composeScore, normalizeLexical } from './ranking';
import type { MemoryReranker } from './reranker';
import { searchTextFor, termsOfStoredText, type QueryGroup } from './stem';

/**
 * How many distinct query words a record must contain to be a result. A
 * one-word query needs that word; anything longer needs two, so a record that
 * shares one incidental word with a five-word question is rejected instead of
 * ranked last. Measured against the evaluation corpus before it was added.
 */
const MIN_COVERAGE_SHORT_QUERY = 1;
const MIN_COVERAGE_LONG_QUERY = 2;
const LONG_QUERY_WORDS = 3;

function requiredCoverage(groups: number): number {
  return groups < LONG_QUERY_WORDS ? MIN_COVERAGE_SHORT_QUERY : MIN_COVERAGE_LONG_QUERY;
}

const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'did', 'do', 'does', 'for', 'from', 'had',
  'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your',
]);

export interface MemoryRetrieverOptions {
  readonly store: MemoryStorePort;
  readonly now: () => number;
  readonly reranker?: MemoryReranker;
}

export class MemoryRetriever {
  constructor(private readonly options: MemoryRetrieverOptions) {}

  async search(query: MemorySearchQuery): Promise<RetrievalResult> {
    const purpose: RetrievalPurpose = query.purpose ?? 'explicit_search';
    const resolved = resolveBudget(purpose, query.budget, query.limit);
    const normalized = normalizeQuery(query.query);
    const significantTerms = normalized.terms.filter((term) => !STOPWORDS.has(term));
    const significantGroups = normalized.groups.filter((group) => !STOPWORDS.has(group.key));
    const indexQuery =
      significantGroups.length > 0
        ? [...new Set(significantGroups.flatMap((group) => group.forms))].join(' ')
        : normalized.text;

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
        const gates = this.evaluateGates(record, prefixes, query, significantGroups);
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
          importance: entry.record.importance,
          confidence: entry.record.confidence,
          updatedAt: entry.record.updatedAt,
          now: Date.now(),
          retention: entry.record.retention,
        });
        return { record: entry.record, explanation: this.explain(entry, components) };
      });

      ranked.sort((a, b) => {
        if (b.explanation.score !== a.explanation.score) return b.explanation.score - a.explanation.score;
        if (a.record.updatedAt !== b.record.updatedAt) return b.record.updatedAt - a.record.updatedAt;
        return a.record.id.localeCompare(b.record.id);
      });

      const reranked =
        this.options.reranker === undefined
          ? ranked
          : await this.options.reranker.rerank({ query: normalized.text, memories: ranked });
      const expanded = await this.expandRelations(reranked, prefixes, query, significantGroups, diagnostics);
      const deduped = this.dedupeResults(expanded, diagnostics);
      const rankedForBudget = this.suppressSuperseded(deduped, diagnostics);

      const applied = applyBudget({
        budget: resolved.budget,
        ranked: rankedForBudget,
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

  private async expandRelations(
    ranked: readonly RetrievedMemory[],
    prefixes: readonly string[],
    query: MemorySearchQuery,
    groups: readonly QueryGroup[],
    diagnostics: MutableDiagnostics,
  ): Promise<RetrievedMemory[]> {
    if (query.expandRelations === false) return [...ranked];
    const depth = Math.min(Math.max(query.maxRelationDepth ?? 1, 1), 2);
    if (depth < 1) return [...ranked];
    const seeds = ranked.slice(0, 10);
    const present = new Set(ranked.map((memory) => memory.record.id));
    const edges: { targetId: string; kind: string }[] = [];
    const seenEdges = new Set<string>();
    const addEdge = (targetId: string, kind: string): void => {
      const key = `${kind}:${targetId}`;
      if (seenEdges.has(key) || edges.length >= 32) return;
      seenEdges.add(key);
      edges.push({ targetId, kind });
    };
    for (const memory of seeds) {
      const record = memory.record;
      for (const relation of record.relations) addEdge(relation.targetId, relation.kind);
      const reverse = await this.options.store.prefixKeys(reverseRelationPrefixFor(record.id), 32);
      for (const key of reverse) {
        const parts = key.split(':');
        const sourceId = parts[3];
        const kind = parts[2];
        if (sourceId !== undefined && kind !== undefined) addEdge(sourceId, kind);
      }
    }
    if (edges.length === 0) return [...ranked];
    const loaded = await this.loadRecords(
      edges.map((edge) => recordKey(edge.targetId)),
      diagnostics,
    );
    const expanded: RetrievedMemory[] = [];
    for (const edge of edges) {
      if (present.has(edge.targetId)) continue;
      const record = loaded.get(recordKey(edge.targetId));
      if (record === undefined) continue;
      const gates = this.evaluateGates(record, prefixes, query, groups, false);
      if (gates.some((gate) => !gate.allowed)) continue;
      const lexical =
        edge.kind === 'supports' || edge.kind === 'refines' || edge.kind === 'caused'
          ? 0.5
          : edge.kind === 'related'
            ? 0.3
            : 0.15;
      const components = composeScore({
        lexical,
        trust: record.trust,
        scope: record.scope.tier,
        accessCount: record.accessCount,
        importance: record.importance,
        confidence: record.confidence,
        updatedAt: record.updatedAt,
        now: Date.now(),
        retention: record.retention,
      });
      present.add(record.id);
      expanded.push({
        record,
        explanation: {
          ...this.explain({ record, gates: [...gates, { gate: 'relation', allowed: true, detail: `${edge.kind} ${edge.targetId}` }] }, components),
        },
      });
    }
    expanded.sort((a, b) => {
      if (b.explanation.score !== a.explanation.score) return b.explanation.score - a.explanation.score;
      return a.record.id.localeCompare(b.record.id);
    });
    diagnostics.relationExpanded = expanded.length;
    return [...ranked, ...expanded];
  }

  private dedupeResults(
    ranked: readonly RetrievedMemory[],
    diagnostics: MutableDiagnostics,
  ): RetrievedMemory[] {
    const seen = new Set<string>();
    const out: RetrievedMemory[] = [];
    for (const memory of ranked) {
      const record = memory.record;
      const scope = scopePrefix(record.scope) ?? record.scope.tier;
      const text = (record.searchText ?? searchTextFor(record.content)).trim().toLowerCase();
      const key = `${scope}|${record.category}|${text}`;
      if (seen.has(key)) {
        diagnostics.duplicatesRemoved = (diagnostics.duplicatesRemoved ?? 0) + 1;
        continue;
      }
      seen.add(key);
      out.push(memory);
    }
    return out;
  }

  private suppressSuperseded(
    ranked: readonly RetrievedMemory[],
    diagnostics: MutableDiagnostics,
  ): RetrievedMemory[] {
    const present = new Set(ranked.map((memory) => memory.record.id));
    const out: RetrievedMemory[] = [];
    for (const memory of ranked) {
      const record = memory.record;
      if (
        record.lifecycle === 'superseded' &&
        record.supersededBy !== undefined &&
        present.has(record.supersededBy)
      ) {
        diagnostics.supersededSuppressed = (diagnostics.supersededSuppressed ?? 0) + 1;
        continue;
      }
      out.push(memory);
    }
    return out;
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
    if (result.truncated) {
      constraints.push(result.hits.length > 0 ? 'maxPostingsVisits' : 'text_index_building');
    }
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
    groups: readonly QueryGroup[],
    requireRelevance = true,
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
      {
        gate: 'lifecycle',
        allowed: record.lifecycle === 'active' || record.lifecycle === 'superseded',
        detail: `lifecycle ${record.lifecycle}`,
      },
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
      { gate: 'legal_hold', allowed: query.includeHeld === true || !record.legalHold, detail: 'legal hold' },
      {
        gate: 'sensitivity',
        allowed:
          SENSITIVITY_RANK[record.sensitivity] <=
          SENSITIVITY_RANK[query.maxSensitivity ?? 'internal'],
        detail: `sensitivity ${record.sensitivity} > ${query.maxSensitivity ?? 'internal'}`,
      },
      ...(!requireRelevance || groups.length === 0 ? [] : [this.relevanceGate(record, groups)]),
    ];
  }

  private relevanceGate(record: MemoryRecord, groups: readonly QueryGroup[]): RetrievalGateDecision {
    const stored = termsOfStoredText(record.searchText ?? searchTextFor(record.content));
    let matched = 0;
    for (const group of groups) {
      if (group.forms.some((form) => stored.has(form))) matched += 1;
    }
    const required = requiredCoverage(groups.length);
    return {
      gate: 'relevance',
      allowed: matched >= required,
      detail: `matched ${String(matched)}/${String(groups.length)} query words (needs ${String(required)})`,
    };
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
  duplicatesRemoved?: number;
  supersededSuppressed?: number;
  relationExpanded?: number;
}

export type { RetrievalStatus };