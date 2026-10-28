import { resumeSessionById, type Scope } from '@hilbras/omnicode-core';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import {
  confirmMemory,
  forgetMemory,
  getVisibleMemory,
  IAgentMemoryContextService,
  IMemoryService,
  listVisibleMemories,
  memoryViewerOf,
  type MemoryControlMutation,
  type MemoryView,
  type MemoryViewer,
} from '@hilbras/omnicode-memory';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  MemoryGetViewSchema,
  MemoryListViewSchema,
  MemoryMutationViewSchema,
  memoryConfirmBodySchema,
  memoryForgetBodySchema,
  memoryGetQuerySchema,
  memoryListViewQuerySchema,
} from '../protocol/rest-memory';
import { ensureMainAgent } from '../transport/mainAgent';

const MEMORY_FLAG_ID = 'memory';
const MEMORY_ENABLED_MESSAGE =
  'Memory is disabled. Enable the memory experimental flag (OMNICODE_EXPERIMENTAL_MEMORY=1) to manage memories.';

const memoryIdParamSchema = z.object({
  memory_id: z.string().min(1),
});

interface MemoryRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; query: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

interface WireMemoryView {
  readonly id: string;
  readonly content: string;
  readonly category: string;
  readonly tier: string;
  readonly trust: string;
  readonly trust_reason: string;
  readonly origin: string;
  readonly source_type: string;
  readonly scope: Record<string, unknown>;
  readonly lifecycle: string;
  readonly subject?: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly expires_at?: number;
  readonly supersedes?: string;
  readonly superseded_by?: string;
  readonly conflicts_with: readonly string[];
  readonly suspicious: boolean;
  readonly suspicion_reasons: readonly string[];
  readonly redaction_count: number;
  readonly stale: boolean;
  readonly approval?: MemoryView['approval'];
  readonly evidence: readonly Record<string, unknown>[];
}

function toWireMemory(view: MemoryView): WireMemoryView {
  return {
    id: view.id,
    content: view.content,
    category: view.category,
    tier: view.tier,
    trust: view.trust,
    trust_reason: view.trustReason,
    origin: view.origin,
    source_type: view.sourceType,
    scope: {
      tier: view.scope.tier,
      workspace_id: view.scope.workspaceId,
      project_id: view.scope.projectId,
      session_id: view.scope.sessionId,
      task_id: view.scope.taskId,
    },
    lifecycle: view.lifecycle,
    subject: view.subject,
    created_at: view.createdAt,
    updated_at: view.updatedAt,
    expires_at: view.expiresAt,
    supersedes: view.supersedes,
    superseded_by: view.supersededBy,
    conflicts_with: view.conflictsWith,
    suspicious: view.suspicious,
    suspicion_reasons: view.suspicionReasons,
    redaction_count: view.redactionCount,
    stale: view.stale,
    approval: view.approval,
    evidence: view.evidence.map((item) => ({
      kind: item.kind,
      ref: item.ref,
      state: item.state,
      observed_at: item.observedAt,
    })),
  };
}

async function resolveViewer(
  core: Scope,
  sessionId: string,
): Promise<
  | { readonly ok: true; readonly viewer: MemoryViewer; readonly service: IMemoryService }
  | { readonly ok: false; readonly error: 'session_not_found' | 'memory_disabled' }
> {
  const session = await resumeSessionById(core.accessor, sessionId);
  if (session === undefined) return { ok: false, error: 'session_not_found' };
  const agent = await ensureMainAgent(session);
  const flags = core.accessor.get(IFlagService);
  if (!flags.enabled(MEMORY_FLAG_ID)) return { ok: false, error: 'memory_disabled' };
  const service = core.accessor.get(IMemoryService);
  if (!service.enabled) return { ok: false, error: 'memory_disabled' };
  const viewer = await memoryViewerOf(agent.accessor.get(IAgentMemoryContextService));
  return { ok: true, viewer, service };
}

function sendGuardError(
  reply: { send(payload: unknown): unknown },
  error: 'session_not_found' | 'memory_disabled',
  requestId: string,
  sessionId: string,
): void {
  if (error === 'session_not_found') {
    reply.send(errEnvelope(ErrorCode.SESSION_NOT_FOUND, `session ${sessionId} does not exist`, requestId));
    return;
  }
  reply.send(errEnvelope(ErrorCode.CAPABILITY_UNSUPPORTED, MEMORY_ENABLED_MESSAGE, requestId));
}

function sendMutation(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  mutation: MemoryControlMutation,
): void {
  const memory = mutation.memory === undefined ? undefined : toWireMemory(mutation.memory);
  switch (mutation.status) {
    case 'confirmed':
    case 'forgotten':
    case 'unchanged':
      reply.send(okEnvelope({ status: mutation.status, memory, reason: mutation.reason }, requestId));
      return;
    case 'not_found':
      reply.send(errEnvelope(ErrorCode.MEMORY_NOT_FOUND, 'memory is not visible to this session', requestId));
      return;
    case 'not_active':
      reply.send(errEnvelope(ErrorCode.MEMORY_NOT_ACTIVE, 'memory is not active', requestId));
      return;
    case 'rejected':
      reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, mutation.reason ?? 'rejected', requestId));
      return;
    case 'disabled':
      reply.send(errEnvelope(ErrorCode.CAPABILITY_UNSUPPORTED, MEMORY_ENABLED_MESSAGE, requestId));
      return;
    case 'failed':
      reply.send(errEnvelope(ErrorCode.PERSISTENCE_FAILURE, mutation.reason ?? 'memory update failed', requestId));
      return;
  }
}

export function registerMemoryRoutes(app: MemoryRouteHost, core: Scope): void {
  const listRoute = defineRoute(
    {
      method: 'GET',
      path: '/memory',
      querystring: memoryListViewQuerySchema,
      success: { data: MemoryListViewSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.CAPABILITY_UNSUPPORTED]: {},
      },
      description: 'List the memories visible to a session',
      tags: ['memory'],
    },
    async (req, reply) => {
      const { session_id, scope, status, limit } = req.query;
      const resolved = await resolveViewer(core, session_id);
      if (!resolved.ok) {
        sendGuardError(reply, resolved.error, req.id, session_id);
        return;
      }
      const listed = await listVisibleMemories(resolved.service, resolved.viewer, { scope, status, limit });
      reply.send(
        okEnvelope(
          { enabled: listed.enabled, memories: listed.memories.map(toWireMemory), truncated: listed.truncated },
          req.id,
        ),
      );
    },
  );
  app.get(listRoute.path, listRoute.options, listRoute.handler as Parameters<MemoryRouteHost['get']>[2]);

  const showRoute = defineRoute(
    {
      method: 'GET',
      path: '/memory/{memory_id}',
      params: memoryIdParamSchema,
      querystring: memoryGetQuerySchema,
      success: { data: MemoryGetViewSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.CAPABILITY_UNSUPPORTED]: {},
        [ErrorCode.MEMORY_NOT_FOUND]: {},
      },
      description: 'Show one memory visible to a session',
      tags: ['memory'],
    },
    async (req, reply) => {
      const { memory_id } = req.params;
      const { session_id } = req.query;
      const resolved = await resolveViewer(core, session_id);
      if (!resolved.ok) {
        sendGuardError(reply, resolved.error, req.id, session_id);
        return;
      }
      const found = await getVisibleMemory(resolved.service, resolved.viewer, memory_id);
      if (found.memory === undefined) {
        reply.send(
          errEnvelope(ErrorCode.MEMORY_NOT_FOUND, `memory ${memory_id} is not visible to this session`, req.id),
        );
        return;
      }
      reply.send(okEnvelope({ enabled: found.enabled, memory: toWireMemory(found.memory) }, req.id));
    },
  );
  app.get(showRoute.path, showRoute.options, showRoute.handler as Parameters<MemoryRouteHost['get']>[2]);

  const confirmRoute = defineRoute(
    {
      method: 'POST',
      path: '/memory/{memory_id}/confirm',
      params: memoryIdParamSchema,
      body: memoryConfirmBodySchema,
      success: { data: MemoryMutationViewSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.CAPABILITY_UNSUPPORTED]: {},
        [ErrorCode.MEMORY_NOT_FOUND]: {},
        [ErrorCode.MEMORY_NOT_ACTIVE]: {},
      },
      description: 'Confirm a memory (promote unverified to trusted)',
      tags: ['memory'],
    },
    async (req, reply) => {
      const { memory_id } = req.params;
      const { session_id } = req.body;
      const resolved = await resolveViewer(core, session_id);
      if (!resolved.ok) {
        sendGuardError(reply, resolved.error, req.id, session_id);
        return;
      }
      sendMutation(reply, req.id, await confirmMemory(resolved.service, resolved.viewer, memory_id));
    },
  );
  app.post(confirmRoute.path, confirmRoute.options, confirmRoute.handler as Parameters<MemoryRouteHost['post']>[2]);

  const forgetRoute = defineRoute(
    {
      method: 'POST',
      path: '/memory/{memory_id}/forget',
      params: memoryIdParamSchema,
      body: memoryForgetBodySchema,
      success: { data: MemoryMutationViewSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.CAPABILITY_UNSUPPORTED]: {},
        [ErrorCode.MEMORY_NOT_FOUND]: {},
        [ErrorCode.MEMORY_NOT_ACTIVE]: {},
      },
      description: 'Forget a memory (invalidate it)',
      tags: ['memory'],
    },
    async (req, reply) => {
      const { memory_id } = req.params;
      const { session_id, reason } = req.body;
      const resolved = await resolveViewer(core, session_id);
      if (!resolved.ok) {
        sendGuardError(reply, resolved.error, req.id, session_id);
        return;
      }
      sendMutation(reply, req.id, await forgetMemory(resolved.service, resolved.viewer, memory_id, reason));
    },
  );
  app.post(forgetRoute.path, forgetRoute.options, forgetRoute.handler as Parameters<MemoryRouteHost['post']>[2]);
}
