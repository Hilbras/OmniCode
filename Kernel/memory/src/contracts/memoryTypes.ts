import { z } from 'zod';

export const MEMORY_TIERS = ['working', 'distilled', 'canonical'] as const;
export type MemoryTier = (typeof MEMORY_TIERS)[number];

export const MEMORY_CATEGORIES = [
  'fact',
  'preference',
  'instruction',
  'policy',
  'observation',
  'task',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_TRUST_LEVELS = ['unverified', 'trusted', 'verified', 'system'] as const;
export type MemoryTrust = (typeof MEMORY_TRUST_LEVELS)[number];

export const TRUST_RANK: Readonly<Record<MemoryTrust, number>> = Object.freeze({
  unverified: 0,
  trusted: 1,
  verified: 2,
  system: 3,
});

export const MEMORY_SOURCE_TYPES = [
  'user_statement',
  'user_correction',
  'repository_file',
  'tool_result',
  'test_result',
  'agent_observation',
  'model_inference',
  'derived',
] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

export const MEMORY_ORIGINS = ['user', 'model', 'application'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export const MEMORY_LIFECYCLES = [
  'active',
  'superseded',
  'expired',
  'invalidated',
  'deleted',
] as const;
export type MemoryLifecycle = (typeof MEMORY_LIFECYCLES)[number];

export const MEMORY_SCOPE_TIERS = [
  'global',
  'workspace',
  'repository',
  'session',
  'task',
] as const;
export type MemoryScopeTier = (typeof MEMORY_SCOPE_TIERS)[number];

export const SCOPE_TIER_RANK: Readonly<Record<MemoryScopeTier, number>> = Object.freeze({
  global: 0,
  workspace: 1,
  repository: 2,
  session: 3,
  task: 4,
});

export const EVIDENCE_KINDS = [
  'file',
  'tool',
  'test',
  'observation',
  'memory',
  'user',
  'system',
] as const;
export type MemoryEvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_STATES = ['present', 'missing', 'changed'] as const;
export type MemoryEvidenceState = (typeof EVIDENCE_STATES)[number];

export const MemoryScopeSchema = z.object({
  tier: z.enum(MEMORY_SCOPE_TIERS),
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
});
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryEvidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  ref: z.string().min(1),
  state: z.enum(EVIDENCE_STATES).default('present'),
  fingerprint: z.string().min(1).optional(),
  observedAt: z.number().int().nonnegative(),
  detail: z.string().max(512).optional(),
});
export type MemoryEvidence = z.infer<typeof MemoryEvidenceSchema>;

export const MemoryApprovalSchema = z.object({
  by: z.enum(['user', 'application']),
  at: z.number().int().nonnegative(),
  reason: z.string().min(1).max(512),
});
export type MemoryApproval = z.infer<typeof MemoryApprovalSchema>;

export const MemoryVerificationSchema = z.object({
  status: z.enum(['unverified', 'verified', 'refuted']),
  checkedAt: z.number().int().nonnegative().optional(),
  method: z.enum(['evidence', 'user_confirmation', 'repository_revision', 'none']),
});
export type MemoryVerification = z.infer<typeof MemoryVerificationSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  tier: z.enum(MEMORY_TIERS),
  category: z.enum(MEMORY_CATEGORIES),
  subject: z.string().min(1).max(256).optional(),
  content: z.string(),
  searchText: z.string().optional(),
  redactionCount: z.number().int().nonnegative(),
  trust: z.enum(MEMORY_TRUST_LEVELS),
  trustReason: z.string().min(1).max(256),
  sourceType: z.enum(MEMORY_SOURCE_TYPES),
  origin: z.enum(MEMORY_ORIGINS),
  scope: MemoryScopeSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lifecycle: z.enum(MEMORY_LIFECYCLES),
  evidence: z.array(MemoryEvidenceSchema),
  derivedFrom: z.array(z.string().min(1)),
  supersedes: z.string().min(1).optional(),
  supersededBy: z.string().min(1).optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative(),
  accessCount: z.number().int().nonnegative(),
  lastAccessedAt: z.number().int().nonnegative().optional(),
  fingerprint: z.string().min(1),
  repoRevision: z.string().min(1).max(64).optional(),
  verification: MemoryVerificationSchema,
  approval: MemoryApprovalSchema.optional(),
  conflictsWith: z.array(z.string().min(1)),
  suspicious: z.boolean(),
  suspicionReasons: z.array(z.string().min(1)),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export function parseMemoryRecord(value: unknown): MemoryRecord | undefined {
  const parsed = MemoryRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function isEffectivelyExpired(record: MemoryRecord, now: number): boolean {
  return record.expiresAt !== undefined && record.expiresAt <= now;
}