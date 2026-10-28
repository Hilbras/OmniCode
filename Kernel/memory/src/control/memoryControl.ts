import type { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import type { IMemoryService } from '#/contracts/memoryContract';
import { TRUST_RANK } from '#/contracts/memoryTypes';
import type {
  MemoryApproval,
  MemoryCategory,
  MemoryEvidenceKind,
  MemoryEvidenceState,
  MemoryLifecycle,
  MemoryOrigin,
  MemoryRecord,
  MemoryScope,
  MemorySourceType,
  MemoryTier,
  MemoryTrust,
} from '#/contracts/memoryTypes';
import { isScopeVisible } from '#/tool/memoryWriteTools';

export const MEMORY_CONTROL_SCOPES = ['global', 'workspace', 'repository', 'session'] as const;
export type MemoryControlScope = (typeof MEMORY_CONTROL_SCOPES)[number];

export const MEMORY_CONTROL_STATUSES = ['active', 'superseded', 'expired', 'invalidated', 'all'] as const;
export type MemoryControlStatus = (typeof MEMORY_CONTROL_STATUSES)[number];

export const MEMORY_EXPORT_FORMAT = 'omnicode.memory.export';
export const MEMORY_EXPORT_VERSION = 1;
export const MEMORY_LIST_DEFAULT_LIMIT = 200;
export const MEMORY_LIST_MAX_LIMIT = 1000;

export interface MemoryViewer {
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly sessionId: string;
}

export interface MemoryEvidenceView {
  readonly kind: MemoryEvidenceKind;
  readonly ref: string;
  readonly state: MemoryEvidenceState;
  readonly observedAt: number;
}

export interface MemoryView {
  readonly id: string;
  readonly content: string;
  readonly category: MemoryCategory;
  readonly tier: MemoryTier;
  readonly trust: MemoryTrust;
  readonly trustReason: string;
  readonly origin: MemoryOrigin;
  readonly sourceType: MemorySourceType;
  readonly scope: MemoryScope;
  readonly lifecycle: MemoryLifecycle;
  readonly subject?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt?: number;
  readonly supersedes?: string;
  readonly supersededBy?: string;
  readonly conflictsWith: readonly string[];
  readonly suspicious: boolean;
  readonly suspicionReasons: readonly string[];
  readonly redactionCount: number;
  readonly approval?: MemoryApproval;
  readonly evidence: readonly MemoryEvidenceView[];
}

export interface MemoryListOptions {
  readonly scope?: MemoryControlScope;
  readonly status?: MemoryControlStatus;
  readonly limit?: number;
}

export interface MemoryListView {
  readonly enabled: boolean;
  readonly memories: readonly MemoryView[];
  readonly truncated: boolean;
}

export interface MemoryGetView {
  readonly enabled: boolean;
  readonly memory?: MemoryView;
}

export type MemoryControlMutationStatus =
  | 'confirmed'
  | 'forgotten'
  | 'unchanged'
  | 'not_found'
  | 'not_active'
  | 'rejected'
  | 'failed'
  | 'disabled';

export interface MemoryControlMutation {
  readonly status: MemoryControlMutationStatus;
  readonly memory?: MemoryView;
  readonly reason?: string;
}

export interface MemoryExportView {
  readonly enabled: boolean;
  readonly format: typeof MEMORY_EXPORT_FORMAT;
  readonly version: typeof MEMORY_EXPORT_VERSION;
  readonly exportedAt: number;
  readonly truncated: boolean;
  readonly memories: readonly MemoryView[];
}

export async function memoryViewerOf(context: IAgentMemoryContextService): Promise<MemoryViewer> {
  return {
    workspaceId: context.workspaceId(),
    projectId: await context.projectId(),
    sessionId: context.sessionId(),
  };
}

export function toMemoryView(record: MemoryRecord): MemoryView {
  return {
    id: record.id,
    content: record.content,
    category: record.category,
    tier: record.tier,
    trust: record.trust,
    trustReason: record.trustReason,
    origin: record.origin,
    sourceType: record.sourceType,
    scope: record.scope,
    lifecycle: record.lifecycle,
    subject: record.subject,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    conflictsWith: record.conflictsWith,
    suspicious: record.suspicious,
    suspicionReasons: record.suspicionReasons,
    redactionCount: record.redactionCount,
    approval: record.approval,
    evidence: record.evidence.map((item) => ({
      kind: item.kind,
      ref: item.ref,
      state: item.state,
      observedAt: item.observedAt,
    })),
  };
}

export async function listVisibleMemories(
  service: IMemoryService,
  viewer: MemoryViewer,
  options: MemoryListOptions = {},
): Promise<MemoryListView> {
  if (!service.enabled) return { enabled: false, memories: [], truncated: false };
  const limit = Math.min(MEMORY_LIST_MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? MEMORY_LIST_DEFAULT_LIMIT)));
  const status = options.status ?? 'active';
  const read = await service.list({
    workspaceId: viewer.workspaceId,
    projectId: viewer.projectId,
    sessionId: viewer.sessionId,
    scopes: options.scope === undefined ? MEMORY_CONTROL_SCOPES : [options.scope],
    lifecycle: status === 'all' ? undefined : [status],
    limit: limit + 1,
  });
  const truncated = read.length > limit;
  const memories = read
    .slice(0, limit)
    .filter((record) => isScopeVisible(record.scope, viewer))
    .map(toMemoryView);
  return { enabled: true, memories, truncated };
}

export async function getVisibleMemory(
  service: IMemoryService,
  viewer: MemoryViewer,
  id: string,
): Promise<MemoryGetView> {
  if (!service.enabled) return { enabled: false };
  const record = await readVisible(service, viewer, id);
  return { enabled: true, memory: record === undefined ? undefined : toMemoryView(record) };
}

export async function confirmMemory(
  service: IMemoryService,
  viewer: MemoryViewer,
  id: string,
): Promise<MemoryControlMutation> {
  if (!service.enabled) return { status: 'disabled' };
  const record = await readVisible(service, viewer, id);
  if (record === undefined) return { status: 'not_found' };
  if (record.lifecycle !== 'active') return { status: 'not_active', memory: toMemoryView(record) };
  if (TRUST_RANK[record.trust] >= TRUST_RANK.trusted) {
    return { status: 'unchanged', memory: toMemoryView(record), reason: `already ${record.trust}` };
  }
  const result = await service.promote({ id: record.id, to: 'trusted', origin: 'user' });
  if (result.status === 'updated' && result.record !== undefined) {
    return { status: 'confirmed', memory: toMemoryView(result.record) };
  }
  return { status: result.status === 'updated' ? 'failed' : result.status, reason: result.reason };
}

export async function forgetMemory(
  service: IMemoryService,
  viewer: MemoryViewer,
  id: string,
  reason?: string,
): Promise<MemoryControlMutation> {
  if (!service.enabled) return { status: 'disabled' };
  const record = await readVisible(service, viewer, id);
  if (record === undefined) return { status: 'not_found' };
  if (record.lifecycle !== 'active') return { status: 'not_active', memory: toMemoryView(record) };
  const note = reason?.trim();
  const result = await service.invalidate(
    record.id,
    note === undefined || note.length === 0 ? 'forgotten by the user' : `forgotten by the user: ${note}`,
  );
  if (result.status === 'updated' && result.record !== undefined) {
    return { status: 'forgotten', memory: toMemoryView(result.record) };
  }
  return { status: result.status === 'updated' ? 'failed' : result.status, reason: result.reason };
}

export async function exportVisibleMemories(
  service: IMemoryService,
  viewer: MemoryViewer,
  now: number = Date.now(),
): Promise<MemoryExportView> {
  const listed = await listVisibleMemories(service, viewer, { status: 'all', limit: MEMORY_LIST_MAX_LIMIT });
  return {
    enabled: listed.enabled,
    format: MEMORY_EXPORT_FORMAT,
    version: MEMORY_EXPORT_VERSION,
    exportedAt: now,
    truncated: listed.truncated,
    memories: listed.memories,
  };
}

async function readVisible(
  service: IMemoryService,
  viewer: MemoryViewer,
  id: string,
): Promise<MemoryRecord | undefined> {
  const trimmed = id.trim();
  if (trimmed.length === 0) return undefined;
  const record = await service.get(trimmed);
  if (record === undefined || !isScopeVisible(record.scope, viewer)) return undefined;
  return record;
}
