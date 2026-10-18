import { type MemoryAuthority, resolveMemoryAuthority } from '#/contracts/memoryAuthority';
import type {
  MemoryApproval,
  MemoryCategory,
  MemoryEvidence,
  MemoryOrigin,
  MemoryRecord,
  MemorySourceType,
  MemoryTier,
  MemoryTrust,
  MemoryVerification,
} from '#/contracts/memoryTypes';
import { TRUST_RANK } from '#/contracts/memoryTypes';
import type { MemoryPolicyViolation } from '#/contracts/memoryContract';

export interface TrustEvaluation {
  readonly trust: MemoryTrust;
  readonly reason: string;
  readonly verification: MemoryVerification;
}

export interface TrustInput {
  readonly sourceType: MemorySourceType;
  readonly origin: MemoryOrigin;
  readonly evidence: readonly MemoryEvidence[];
  readonly authority?: MemoryAuthority;
}

export interface PromotionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const USER_SOURCES: ReadonlySet<MemorySourceType> = new Set<MemorySourceType>([
  'user_statement',
  'user_correction',
]);

const MODEL_SOURCES: ReadonlySet<MemorySourceType> = new Set<MemorySourceType>([
  'model_inference',
  'derived',
]);

export function verificationFromEvidence(
  evidence: readonly MemoryEvidence[] | undefined,
  at: number,
): MemoryVerification {
  const confirming = (evidence ?? []).filter(
    (item) => item.state === 'present' && typeof item.fingerprint === 'string' && item.fingerprint.length > 0,
  );
  if (confirming.length === 0) {
    return { status: 'unverified', method: 'none' };
  }
  return { status: 'verified', checkedAt: at, method: 'evidence' };
}

export function evaluateInitialTrust(input: TrustInput, at: number): TrustEvaluation {
  const verification = verificationFromEvidence(input.evidence, at);
  const authority = resolveMemoryAuthority(input.authority);
  if (authority !== undefined) {
    return { trust: 'system', reason: `issued by application authority: ${authority.label}`, verification };
  }
  if (input.origin === 'model' && USER_SOURCES.has(input.sourceType)) {
    return {
      trust: 'unverified',
      reason: 'model-authored input cannot be attributed to the user',
      verification,
    };
  }
  if (input.origin === 'model' && MODEL_SOURCES.has(input.sourceType)) {
    return {
      trust: 'unverified',
      reason: 'model-authored inference; repetition and rewrites never raise trust',
      verification,
    };
  }
  if (USER_SOURCES.has(input.sourceType)) {
    return { trust: 'trusted', reason: 'stated directly by the user', verification };
  }
  if (verification.status === 'verified') {
    return { trust: 'verified', reason: 'supported by present evidence with a fingerprint', verification };
  }
  return {
    trust: 'unverified',
    reason: 'no present evidence with a content fingerprint',
    verification,
  };
}

export function evaluatePromotion(
  record: MemoryRecord,
  to: MemoryTrust,
  origin: MemoryOrigin,
  options: { readonly authority?: MemoryAuthority; readonly evidence?: readonly MemoryEvidence[]; readonly at: number },
): PromotionDecision {
  const authority = resolveMemoryAuthority(options.authority);
  if (to === 'system') {
    return authority === undefined
      ? { allowed: false, reason: 'system trust requires an authority issued by the host application' }
      : { allowed: true, reason: `system trust granted by authority: ${authority.label}` };
  }
  if (TRUST_RANK[to] <= TRUST_RANK[record.trust]) {
    return { allowed: true, reason: 'demotion or no-op' };
  }
  if (origin === 'model') {
    return { allowed: false, reason: 'a model cannot promote a memory it authored' };
  }
  if (to === 'verified') {
    const evidence = options.evidence ?? record.evidence ?? [];
    const verification = verificationFromEvidence(evidence, options.at);
    return verification.status === 'verified'
      ? { allowed: true, reason: 'promoted by evidence verification' }
      : { allowed: false, reason: 'verification requires present evidence with a fingerprint' };
  }
  if (to === 'trusted') {
    return { allowed: true, reason: 'promoted by explicit confirmation outside the conversation' };
  }
  return { allowed: true, reason: 'promotion allowed' };
}

export interface TierAdmissionInput {
  readonly tier: MemoryTier;
  readonly category: MemoryCategory;
  readonly origin: MemoryOrigin;
  readonly trust: MemoryTrust;
  readonly authority?: MemoryAuthority;
  readonly approval?: MemoryApproval;
}

const CANONICAL_CATEGORIES: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>([
  'fact',
  'preference',
  'instruction',
  'policy',
]);

export function checkTierAdmission(input: TierAdmissionInput): readonly MemoryPolicyViolation[] {
  const authority = resolveMemoryAuthority(input.authority);
  const violations: MemoryPolicyViolation[] = [];
  if (input.tier !== 'canonical') {
    if (input.tier === 'distilled' && input.category === 'task') {
      violations.push({
        rule: 'tier.category',
        message: 'task state belongs to working memory, not distilled memory',
      });
    }
    if (input.tier === 'working' && input.category === 'policy') {
      violations.push({
        rule: 'tier.category',
        message: 'security policy cannot be carried in working memory',
      });
    }
    return violations;
  }
  if (!CANONICAL_CATEGORIES.has(input.category)) {
    violations.push({
      rule: 'canonical.category',
      message: `category '${input.category}' is not a canonical category`,
    });
    return violations;
  }
  if (input.category === 'policy' && authority === undefined) {
    violations.push({
      rule: 'canonical.policy',
      message: 'canonical policy requires an authority issued by the host application',
    });
  }
  if (input.category === 'instruction') {
    if (input.origin === 'model') {
      violations.push({
        rule: 'canonical.instruction.origin',
        message: 'a model cannot author canonical instructions',
      });
    }
    if (input.trust === 'unverified') {
      violations.push({
        rule: 'canonical.instruction.trust',
        message: 'unverified content cannot become a canonical instruction',
      });
    }
    if (authority === undefined && input.approval === undefined) {
      violations.push({
        rule: 'canonical.instruction.approval',
        message: 'canonical instructions require an explicit approval',
      });
    }
  }
  if (input.category !== 'policy' && authority === undefined && input.approval === undefined) {
    if (TRUST_RANK[input.trust] < TRUST_RANK.trusted) {
      violations.push({
        rule: 'canonical.trust',
        message: 'canonical memory requires at least trusted content or an explicit approval',
      });
    }
  }
  return violations;
}