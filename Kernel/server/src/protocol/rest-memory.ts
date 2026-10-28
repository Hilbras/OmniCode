import { z } from 'zod';

const MemoryControlScope = z.enum(['global', 'workspace', 'repository', 'session']);
const MemoryControlStatus = z.enum(['active', 'superseded', 'expired', 'invalidated', 'all']);
const MemoryScopeTier = z.enum(['global', 'workspace', 'repository', 'session', 'task']);
const MemoryTier = z.enum(['working', 'distilled', 'canonical']);
const MemoryCategory = z.enum(['fact', 'preference', 'observation', 'task']);
const MemoryTrust = z.enum(['unverified', 'trusted', 'verified', 'system']);
const MemoryOrigin = z.enum(['user', 'model', 'application']);
const MemorySourceType = z.enum([
  'command',
  'tool_result',
  'test_result',
  'agent_observation',
  'model_inference',
  'derived',
]);
const MemoryLifecycle = z.enum(['active', 'superseded', 'expired', 'invalidated', 'deleted']);
const MemoryEvidenceKind = z.enum(['file', 'tool', 'test', 'observation', 'memory', 'user', 'system']);
const MemoryEvidenceState = z.enum(['present', 'missing', 'changed']);
const ApprovalBy = z.enum(['user', 'application']);

export const MemoryEvidenceSchema = z.object({
  kind: MemoryEvidenceKind,
  ref: z.string().min(1),
  state: MemoryEvidenceState,
  observed_at: z.number().int().nonnegative(),
});
export const MemoryScopeSchema = z.object({
  tier: MemoryScopeTier,
  workspace_id: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
});
export const MemoryApprovalSchema = z.object({
  by: ApprovalBy,
  at: z.number().int().nonnegative(),
  reason: z.string().min(1).max(512),
});

export const MemoryViewSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  category: MemoryCategory,
  tier: MemoryTier,
  trust: MemoryTrust,
  trust_reason: z.string().min(1).max(256),
  origin: MemoryOrigin,
  source_type: MemorySourceType,
  scope: MemoryScopeSchema,
  lifecycle: MemoryLifecycle,
  subject: z.string().min(1).max(256).optional(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative().optional(),
  supersedes: z.string().min(1).optional(),
  superseded_by: z.string().min(1).optional(),
  conflicts_with: z.array(z.string().min(1)),
  suspicious: z.boolean(),
  suspicion_reasons: z.array(z.string().min(1)),
  redaction_count: z.number().int().nonnegative(),
  approval: MemoryApprovalSchema.optional(),
  evidence: z.array(MemoryEvidenceSchema),
});
export const MemoryListViewSchema = z.object({
  enabled: z.boolean(),
  memories: z.array(MemoryViewSchema),
  truncated: z.boolean(),
});
export const MemoryGetViewSchema = z.object({
  enabled: z.boolean(),
  memory: MemoryViewSchema.optional(),
});
export const MemoryMutationViewSchema = z.object({
  status: z.enum(['confirmed', 'forgotten', 'unchanged', 'not_found', 'not_active', 'rejected', 'failed', 'disabled']),
  memory: MemoryViewSchema.optional(),
  reason: z.string().optional(),
});
export const MemoryExportViewSchema = z.object({
  enabled: z.boolean(),
  format: z.literal('omnicode.memory.export'),
  version: z.literal(1),
  exported_at: z.number().int().nonnegative(),
  truncated: z.boolean(),
  memories: z.array(MemoryViewSchema),
});

export const memoryListViewQuerySchema = z.object({
  session_id: z.string().min(1),
  scope: MemoryControlScope.optional(),
  status: MemoryControlStatus.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const memoryGetQuerySchema = z.object({
  session_id: z.string().min(1),
});

export const memoryConfirmBodySchema = z.object({
  session_id: z.string().min(1),
});

export const memoryForgetBodySchema = z.object({
  session_id: z.string().min(1),
  reason: z.string().min(1).max(500).optional(),
});
