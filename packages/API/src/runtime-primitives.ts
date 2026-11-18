import {
  ISessionSearchService,
  LifecycleScope,
  overrideScopedService,
  ScopeActivation,
} from '@hilbras/omnicode-core';
import { FileSessionSearchService } from '@hilbras/omnicode-engine/features/sessionSearch/fileSessionSearch';

overrideScopedService(
  LifecycleScope.App,
  ISessionSearchService,
  FileSessionSearchService,
  ScopeActivation.OnDemand,
  'sessionSearchLocal',
);

export {
  InMemorySessionSearchSource,
  LocalSessionSearchService,
} from '@hilbras/omnicode-engine/features/sessionSearch/localSessionSearch';
export type {
  SessionSearchDocument,
  SessionSearchSource,
} from '@hilbras/omnicode-engine/features/sessionSearch/localSessionSearch';

export { SessionLeaseService } from '@hilbras/omnicode-engine/app/sessionManager/sessionLease';
export type {
  SessionLeaseAcquireResult,
  SessionLeaseOptions,
  SessionLeaseRecord,
} from '@hilbras/omnicode-engine/app/sessionManager/sessionLease';

export { FileInteractionPersistence } from '@hilbras/omnicode-engine/human/interaction/persistence';
export type { InteractionPersistence } from '@hilbras/omnicode-engine/human/interaction/persistence';

export { FileTeamPersistence } from '@hilbras/omnicode-engine/agent/team/teamPersistence';

export {
  diffContextSections,
  projectContextSections,
  renderContextSectionDelta,
} from '@hilbras/omnicode-engine/agent/contextProjector/sections';
export type {
  ContextProjection,
  ContextSection,
  ContextSectionChange,
  ContextSectionDelta,
} from '@hilbras/omnicode-engine/agent/contextProjector/sections';

export { scoreTrajectory } from '@hilbras/omnicode-engine/agent/evals/trajectory';
export type {
  EvalExpectation,
  EvalScore,
  EvalToolCall,
  EvalTrajectory,
  EvalTurn,
} from '@hilbras/omnicode-engine/agent/evals/trajectory';

export {
  CostBudget,
  ModelPricingTable,
  addCost,
  costOfUsage,
  formatUsd,
  unknownCost,
} from '@hilbras/omnicode-llm';
export type {
  CostBreakdown,
  CostBudgetSnapshot,
  ModelPricing,
} from '@hilbras/omnicode-llm';

export {
  ProviderDescriptorRegistry,
  patternMatcher,
  prefixMatcher,
  validateKeyPrefix,
  validateNonEmptyKey,
} from '@hilbras/omnicode-llm';
export type {
  ProviderDescriptor,
  ProviderValidation,
} from '@hilbras/omnicode-llm';

export {
  isFallbackEligibleError,
  meetsCapability,
  selectFallbackCandidate,
} from '@hilbras/omnicode-llm';
export type {
  FallbackCandidate,
  FallbackSelectionInput,
} from '@hilbras/omnicode-llm';
