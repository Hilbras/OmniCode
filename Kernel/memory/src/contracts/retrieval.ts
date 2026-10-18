import type {
  MemoryCategory,
  MemoryEvidence,
  MemoryRecord,
  MemoryScopeTier,
  MemoryTier,
  MemoryTrust,
} from './memoryTypes';

export const RETRIEVAL_STATUSES = [
  'complete',
  'partial',
  'no_match',
  'unavailable',
  'failed',
] as const;
export type RetrievalStatus = (typeof RETRIEVAL_STATUSES)[number];

export const RETRIEVAL_PURPOSES = ['explicit_search', 'auto_inject', 'session_restore'] as const;
export type RetrievalPurpose = (typeof RETRIEVAL_PURPOSES)[number];

export const BUDGET_CONSTRAINTS = [
  'maxResults',
  'maxContextChars',
  'maxMemoryChars',
  'maxCandidates',
  'maxPostingsVisits',
  'text_index_building',
  'scope_candidates',
] as const;
export type BudgetConstraint = (typeof BUDGET_CONSTRAINTS)[number];

export const DEFAULT_RETRIEVAL_BUDGET: RetrievalBudget = Object.freeze({
  maxResults: 8,
  maxContextChars: 4000,
  maxMemoryChars: 600,
  maxCandidates: 400,
  maxPostingsVisits: 50_000,
});

export const AUTO_INJECT_RETRIEVAL_BUDGET: RetrievalBudget = Object.freeze({
  maxResults: 5,
  maxContextChars: 1500,
  maxMemoryChars: 300,
  maxCandidates: 60,
  maxPostingsVisits: 10_000,
});

export interface RetrievalBudget {
  readonly maxResults: number;
  readonly maxContextChars: number;
  readonly maxMemoryChars: number;
  readonly maxCandidates: number;
  readonly maxPostingsVisits: number;
}

export interface RetrievalBudgetReport {
  readonly applied: RetrievalBudget;
  readonly truncated: boolean;
  readonly constraints: readonly BudgetConstraint[];
  readonly droppedByBudget: number;
  readonly mayBeIncomplete: boolean;
}

export interface MemorySearchQuery {
  readonly query: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly scopes?: readonly MemoryScopeTier[];
  readonly tiers?: readonly MemoryTier[];
  readonly categories?: readonly MemoryCategory[];
  readonly minTrust?: MemoryTrust;
  readonly includeUntrusted?: boolean;
  readonly purpose?: RetrievalPurpose;
  readonly budget?: Partial<RetrievalBudget>;
  readonly limit?: number;
}

export interface RetrievalGateDecision {
  readonly gate:
    | 'scope'
    | 'tier'
    | 'lifecycle'
    | 'expiry'
    | 'trust'
    | 'category'
    | 'suspicion'
    | 'integrity';
  readonly allowed: boolean;
  readonly detail: string;
}

export interface RetrievalScoreComponents {
  readonly lexical: number;
  readonly trust: number;
  readonly scope: number;
  readonly reinforcement: number;
  readonly total: number;
}

export interface RetrievalExplanation {
  readonly memoryId: string;
  readonly tier: MemoryTier;
  readonly category: MemoryCategory;
  readonly trust: MemoryTrust;
  readonly sourceType: MemoryRecord['sourceType'];
  readonly scopeTier: MemoryScopeTier;
  readonly lifecycle: MemoryRecord['lifecycle'];
  readonly score: number;
  readonly components: RetrievalScoreComponents;
  readonly gates: readonly RetrievalGateDecision[];
  readonly evidence: readonly MemoryEvidence[];
  readonly suspicious: boolean;
  readonly suspiciousReasons: readonly string[];
  readonly redacted: boolean;
  readonly conflictsWith: readonly string[];
}

export interface RetrievedMemory {
  readonly record: MemoryRecord;
  readonly explanation: RetrievalExplanation;
}

export interface RetrievalDiagnostics {
  readonly normalizedQuery: string;
  readonly queryTerms: readonly string[];
  readonly scopePrefixes: readonly string[];
  readonly scopeCandidates: number;
  readonly lexicalCandidates: number;
  readonly lexicalTruncated: boolean;
  readonly lexicalVisits: number;
  readonly rejected: readonly RetrievalGateDecision[];
}

export interface RetrievalResult {
  readonly status: RetrievalStatus;
  readonly query: string;
  readonly purpose: RetrievalPurpose;
  readonly memories: readonly RetrievedMemory[];
  readonly budget: RetrievalBudgetReport;
  readonly diagnostics: RetrievalDiagnostics;
  readonly context: string;
  readonly notice?: string;
}

export const RETRIEVAL_NOTICE_INCOMPLETE =
  'Memory retrieval is incomplete or unavailable. Do not assume that missing information was never stored.';