import './feature/configSection';
import './feature/flag';
import './feature/memoryFeature';

export { MemoryError, MemoryErrors, isMemoryError } from '#/contracts/errors';
export type { MemoryErrorCode } from '#/contracts/errors';
export { issueMemoryAuthority, resolveMemoryAuthority } from '#/contracts/memoryAuthority';
export type { MemoryAuthority } from '#/contracts/memoryAuthority';
export { IMemoryService } from '#/contracts/memoryContract';
export type {
  IMemoryService as IMemoryServiceContract,
  MemoryApprovalRequest,
  MemoryCaptureInput,
  MemoryCaptureResult,
  MemoryCaptureStatus,
  MemoryDiagnostics,
  MemoryListQuery,
  MemoryMutationResult,
  MemoryPolicyViolation,
  MemoryPromotionRequest,
  MemoryReviewJob,
  MemoryReviewJobReport,
  MemoryReviewJobStatus,
  MemoryReviewReport,
  MemoryStaleFinding,
  MemoryStaleReport,
  MemorySupersedeInput,
  MemoryTaskRestore,
  MemoryTaskState,
  MemoryTaskStateInput,
  MemoryUpdatePatch,
} from '#/contracts/memoryContract';
export {
  EVIDENCE_KINDS,
  EVIDENCE_STATES,
  MEMORY_CATEGORIES,
  MEMORY_LIFECYCLES,
  MEMORY_ORIGINS,
  MEMORY_SCOPE_TIERS,
  MEMORY_SOURCE_TYPES,
  MEMORY_TIERS,
  MEMORY_TRUST_LEVELS,
  MemoryEvidenceSchema,
  MemoryRecordSchema,
  MemoryScopeSchema,
  TRUST_RANK,
  isEffectivelyExpired,
  parseMemoryRecord,
} from '#/contracts/memoryTypes';
export type {
  MemoryApproval,
  MemoryCategory,
  MemoryEvidence,
  MemoryEvidenceKind,
  MemoryEvidenceState,
  MemoryLifecycle,
  MemoryOrigin,
  MemoryRecord,
  MemoryScope,
  MemoryScopeTier,
  MemorySourceType,
  MemoryTier,
  MemoryTrust,
  MemoryVerification,
} from '#/contracts/memoryTypes';
export {
  AUTO_INJECT_RETRIEVAL_BUDGET,
  BUDGET_CONSTRAINTS,
  DEFAULT_RETRIEVAL_BUDGET,
  RETRIEVAL_NOTICE_INCOMPLETE,
  RETRIEVAL_PURPOSES,
  RETRIEVAL_STATUSES,
} from '#/contracts/retrieval';
export type {
  BudgetConstraint,
  MemorySearchQuery,
  RetrievalBudget,
  RetrievalBudgetReport,
  RetrievalDiagnostics,
  RetrievalExplanation,
  RetrievalGateDecision,
  RetrievalPurpose,
  RetrievalResult,
  RetrievalScoreComponents,
  RetrievalStatus,
  RetrievedMemory,
} from '#/contracts/retrieval';

export { MEMORY_SECTION, MemoryConfigSchema } from '#/feature/configSection';
export type { MemoryConfig } from '#/feature/configSection';
export { MEMORY_FLAG_ENV, MEMORY_FLAG_ID, memoryFlag } from '#/feature/flag';
export { MemoryFeature } from '#/feature/memoryFeature';

export { MemoryService, TASK_STATE_SUBJECT_PREFIX } from '#/service/memoryService';
export { AppMemoryService } from '#/service/appMemoryService';
export { DEFAULT_MEMORY_SETTINGS } from '#/service/memorySettings';
export type { MemoryPolicySettings } from '#/service/memorySettings';
export { MEMORY_DIR_NAME, createMemoryRuntime, resolveMemoryDir } from '#/service/memoryRuntime';
export {
  MemoryMaintenanceScheduler,
  REVIEW_BATCH,
  REVIEW_DEBOUNCE_MS,
  REVIEW_POLL_MS,
  RETENTION_SWEEP_MS,
  WORKING_GRACE_MS,
} from '#/service/memoryMaintenance';
export type { MemoryMaintenanceOptions, MemoryTimers } from '#/service/memoryMaintenance';
export { buildRecord, hashContent } from '#/service/memoryRecordFactory';
export { evidenceForFile, fingerprintText, isFingerprintOfKind } from '#/service/evidence';
export { resolveProjectIdentity } from '#/service/projectIdentity';
export type { ProjectIdentity } from '#/service/projectIdentity';

export { InMemoryMemoryStore, MemoryStoreUnavailableError } from '#/storage/memoryStore';
export type {
  MemoryStoreOp,
  MemoryStorePort,
  MemoryTextHit,
  MemoryTextSearchOptions,
  MemoryTextSearchResult,
  TextIndexState,
} from '#/storage/memoryStore';
export { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';
export { MEMORY_SCHEMA_VERSION, scopeKeyFor, scopePrefix } from '#/storage/memoryKeys';

export { MemoryRetriever } from '#/retrieval/memoryRetriever';
export { average, evaluate, precisionAtK, recallAtK, reciprocalRank } from '#/retrieval/evaluation';
export { EVAL_CORPUS, EVAL_QUERIES } from '#/retrieval/evaluation';
export type {
  EvaluationCase,
  LabelledMemory,
  RankingMetrics,
  RelevanceJudgement,
} from '#/retrieval/evaluation';
export { composeScore, normalizeLexical, reinforcementWeight, trustWeight } from '#/retrieval/ranking';
export { CONTEXT_HEADER, applyBudget, renderMemory, resolveBudget } from '#/retrieval/budget';
export { normalizeQuery } from '#/retrieval/normalize';
export { indexTerms, queryTerms, searchTextFor, stem } from '#/retrieval/stem';

export { redactMemoryContent } from '#/security/redaction';
export { SUSPICION_RULE_IDS, analyzeMemoryContent } from '#/security/suspicion';

export {
  checkTierAdmission,
  evaluateInitialTrust,
  evaluatePromotion,
  verificationFromEvidence,
} from '#/trust/trustPolicy';
export type { PromotionDecision, TrustEvaluation } from '#/trust/trustPolicy';

export {
  AgentMemoryContextService,
  IAgentMemoryContextService,
  MEMORY_INJECTION_VARIANT,
  MEMORY_RESTORE_VARIANT,
} from '#/context/agentMemoryContextService';
export { AgentMemoryInjectionService, IMemoryInjectionService } from '#/context/memoryInjectionService';
export type { MemoryInjectionDisclosure } from '#/context/memoryInjectionService';

export {
  IMemorySearchTool,
  MEMORY_SEARCH_DESCRIPTION,
  MEMORY_SEARCH_TOOL_NAME,
  MemorySearchInputSchema,
  MemorySearchTool,
  renderResult,
} from '#/tool/memorySearchTool';
export type { IMemorySearchTool as IMemorySearchToolContract, MemorySearchInput } from '#/tool/memorySearchTool';
export {
  IMemoryForgetTool,
  IMemorySaveTool,
  isScopeVisible,
  MEMORY_FORGET_DESCRIPTION,
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_SAVE_DESCRIPTION,
  MEMORY_SAVE_TOOL_NAME,
  MemoryForgetInputSchema,
  MemoryForgetTool,
  MemorySaveInputSchema,
  MemorySaveTool,
  renderCapture,
} from '#/tool/memoryWriteTools';
export type { MemoryForgetInput, MemorySaveInput } from '#/tool/memoryWriteTools';
export {
  confirmMemory,
  exportVisibleMemories,
  forgetMemory,
  getVisibleMemory,
  listVisibleMemories,
  MEMORY_CONTROL_SCOPES,
  MEMORY_CONTROL_STATUSES,
  MEMORY_EXPORT_FORMAT,
  MEMORY_EXPORT_VERSION,
  MEMORY_LIST_DEFAULT_LIMIT,
  MEMORY_LIST_MAX_LIMIT,
  memoryViewerOf,
  toMemoryView,
} from '#/control/memoryControl';
export type {
  MemoryControlMutation,
  MemoryControlMutationStatus,
  MemoryControlScope,
  MemoryControlStatus,
  MemoryEvidenceView,
  MemoryExportView,
  MemoryGetView,
  MemoryListOptions,
  MemoryListView,
  MemoryView,
  MemoryViewer,
} from '#/control/memoryControl';
