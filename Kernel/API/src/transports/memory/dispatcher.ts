/**
 * In-process dispatcher — resolves a wire triple `(service, method, args)`
 * against a live engine scope and mirrors kap-server's dispatcher semantics
 * (reflection call, non-function members are property reads, `main` agent
 * auto-materialized via `ensureMainAgent`). Scope routing resolves workspace
 * instances through `IWorkspaceInstanceManager` and live sessions through the
 * App `SessionManager`, matching the server's `resolveScope`. Every argument,
 * result, and event payload passes
 * through `wireClone` (a JSON round-trip), so consumers observe
 * byte-identical data no matter whether the call crossed a socket or stayed
 * in-process — and non-serializable leaks fail early.
 *
 * Shared by the memory transport and the IPC host, which guarantees ipc and
 * memory behave identically by construction.
 */

import { Readable } from 'node:stream';

import type { IAgentScopeHandle } from '@hilbras/omnicode-base/di/scope';
import type { SkillActivationOrigin } from '@hilbras/omnicode-core/agent/contextMemory/types';
import { IAgentLoopService } from '@hilbras/omnicode-core/agent/loop/loop';
import { agentContextOf } from '@hilbras/omnicode-core/agent/scopeContext/scopeContext';
import { IEventBus } from '@hilbras/omnicode-core/app/event/eventBus';
import type { FileMeta, GetResult, SaveOptions } from '@hilbras/omnicode-core/app/file/fileService';
import { FileErrors } from '@hilbras/omnicode-core/app/file/fileService';
import { getLiveSessionById } from '@hilbras/omnicode-core/app/sessionManager/sessionLookup';
import { ISessionManager } from '@hilbras/omnicode-core/app/sessionManager/sessionManager';
import { ITelemetryService } from '@hilbras/omnicode-core/app/telemetry/telemetry';
import { Error2, ErrorCodes } from '@hilbras/omnicode-core/errors';
import type {
  PromptWithSkillsInput,
  SkillActivationInput,
} from '@hilbras/omnicode-core/features/skill/skill';
import { IAgentSkillService } from '@hilbras/omnicode-core/features/skill/skillService';
import { interactions } from '@hilbras/omnicode-core/human/interaction/facade';
import {
  INTERACTION_TAG_AGENT_ID,
  INTERACTION_TAG_SESSION_ID,
  type Interaction,
  type InteractionKind,
  type InteractionRequest,
} from '@hilbras/omnicode-core/human/interaction/interaction';
import { IAgentLifecycleService } from '@hilbras/omnicode-core/session/agentLifecycle/agentLifecycle';
import { MAIN_AGENT_ID } from '@hilbras/omnicode-core/session/agentLifecycle/agentLifecycle';
import { ensureMainAgent } from '@hilbras/omnicode-core/session/agentLifecycle/mainAgent';
import { IWorkspaceInstanceManager } from '@hilbras/omnicode-core/workspace/workspaceInstance/workspaceInstanceManager';

import type { IDisposable, ScopeRef } from '@hilbras/omnicode-rpc/channel';
import { RPCError } from '@hilbras/omnicode-rpc/errors';
import { IEventService, serviceTokens } from './serviceRegistry.js';

import {
  createDispatcher,
  wireClone,
  type Dispatcher as MemoryDispatcher,
  type ResolvedScope,
  type ScopeLike,
} from '@hilbras/omnicode-rpc/dispatch';

export { wireClone, type ResolvedScope, type ScopeLike };
export type { Dispatcher as MemoryDispatcher } from '@hilbras/omnicode-rpc/dispatch';

/**
 * `sessionInteractionService` stays on the wire after the engine moved the
 * interaction kernel into a process-global module singleton: the view
 * forwards to the singleton, scoping every call by the `sessionId` tag.
 */
function pendingInteractionsOfSession(sessionId: string): readonly Interaction[] {
  return interactions.findAll({
    resolved: false,
    tags: { [INTERACTION_TAG_SESSION_ID]: sessionId },
  });
}

function pendingIdsOfSession(sessionId: string): readonly string[] {
  return pendingInteractionsOfSession(sessionId).map((i) => i.id);
}

function respondScoped(sessionId: string, id: string, response: unknown): boolean {
  if (
    interactions.findOne({
      id,
      resolved: false,
      tags: { [INTERACTION_TAG_SESSION_ID]: sessionId },
    }) === undefined
  ) {
    return false;
  }
  return interactions.respond(id, response);
}

function withSessionTags<TPayload>(
  sessionId: string,
  req: InteractionRequest<TPayload>,
): InteractionRequest<TPayload> {
  return {
    ...req,
    tags: {
      ...req.tags,
      [INTERACTION_TAG_AGENT_ID]: req.tags?.[INTERACTION_TAG_AGENT_ID] ?? MAIN_AGENT_ID,
      [INTERACTION_TAG_SESSION_ID]: sessionId,
    },
  };
}

function interactionServiceView(sessionId: string): Record<string, unknown> {
  return {
    request: (req: InteractionRequest<unknown>) =>
      interactions.request(withSessionTags(sessionId, req)),
    enqueue: (req: InteractionRequest<unknown>) =>
      interactions.enqueue(withSessionTags(sessionId, req)),
    respond: (id: string, response: unknown) => {
      respondScoped(sessionId, id, response);
    },
    listPending: (kind?: InteractionKind) =>
      interactions.findAll({
        kind,
        resolved: false,
        tags: { [INTERACTION_TAG_SESSION_ID]: sessionId },
      }),
    isRecentlyResolved: (id: string) =>
      interactions.findOne({
        id,
        resolved: true,
        tags: { [INTERACTION_TAG_SESSION_ID]: sessionId },
      }) !== undefined,
    onDidChangePending: (listener: (event: unknown) => void) =>
      interactions.onDidChangePending(listener),
    onDidResolve: (listener: (event: unknown) => void) => interactions.onDidResolve(listener),
  };
}

/**
 * `sessionApprovalService` / `sessionQuestionService` stay on the wire as
 * facade views over the same singleton: lists are the session's pending
 * payloads with their interaction ids, decisions write back through
 * `respond`.
 */
function approvalServiceView(sessionId: string): Record<string, unknown> {
  return {
    listPending: () =>
      pendingInteractionsOfSession(sessionId)
        .filter((i) => i.kind === 'approval')
        .map((i) => ({ ...(i.payload as Record<string, unknown>), id: i.id })),
    decide: (id: string, response: unknown) => {
      respondScoped(sessionId, id, response);
    },
  };
}

function questionServiceView(sessionId: string): Record<string, unknown> {
  return {
    listPending: () =>
      pendingInteractionsOfSession(sessionId)
        .filter((i) => i.kind === 'question')
        .map((i) => ({ ...(i.payload as Record<string, unknown>), id: i.id })),
    answer: (id: string, result: unknown) => {
      respondScoped(sessionId, id, result);
    },
    dismiss: (id: string) => {
      respondScoped(sessionId, id, null);
    },
  };
}

/**
 * `agentSkillService` stays on the wire after the engine moved the skill
 * kernel into a per-agent DI service: the view forwards to the agent's
 * `IAgentSkillService` resolved straight from the agent scope handle.
 */
function agentSkillServiceView(agent: IAgentScopeHandle): Record<string, unknown> {
  const skill = agent.accessor.get(IAgentSkillService);
  return {
    activate: (input: SkillActivationInput) => skill.activate(input),
    promptWithSkills: (input: PromptWithSkillsInput) => skill.promptWithSkills(input),
    recordModelToolActivation: (origin: SkillActivationOrigin) => {
      skill.recordModelToolActivation(origin);
    },
  };
}

function agentLoopServiceView(agent: IAgentScopeHandle): Record<string, unknown> {
  const loop = agent.accessor.get(IAgentLoopService);
  return {
    cancelFromUser: (turnId?: number) => {
      const snapshot = loop.snapshot();
      if (snapshot.state === 'running') {
        agent.accessor.get(ITelemetryService).track2('cancel', {
          from: 'streaming',
          trace_id: snapshot.activeTraceId,
        });
      }
      loop.cancel(turnId === undefined ? undefined : { turnId });
    },
  };
}

const REQUEST_INVALID = 40001;
const NOT_FOUND = 40404;
/** kap-server wire codes mirrored so memory/ipc surface the same numeric codes as `/api/v2/mcp`. */
const MCP_SERVER_NOT_FOUND = 40408;
const MCP_OAUTH_FAILED = 40929;
const PROMPT_ID_CONFLICT = 40927;

/** Wire name of the engine's `IMcpManagementService` decorator id. */
const MCP_MANAGEMENT_SERVICE = 'mcpManagementService';

/**
 * Session-scope domain services whose methods take the lifecycle-issued
 * `AgentContext` as their first argument. The wire stays agentId-only (the
 * scope ref already carries it), so the live context is resolved here at the
 * edge — after `wireClone`, since the context is a live object that must
 * never cross the JSON round-trip.
 */
const AGENT_CONTEXT_SERVICES: ReadonlySet<string> = new Set([
  'agentTokenCountingService',
  'agentUsageService',
]);

/**
 * Engine file errors cross the facade as public `RPCError`s, never as the
 * engine's raw `Error2`. The dispatcher is shared by both transports, so
 * memory and ipc then surface the identical `NOT_FOUND` code for a stale or
 * expired upload id.
 */
function rethrowFileErrorAsRpc(error: unknown): never {
  if (error instanceof Error2 && error.code === FileErrors.codes.FILE_NOT_FOUND) {
    throw new RPCError(NOT_FOUND, error.message, error.details);
  }
  throw error;
}

/**
 * Same treatment for the MCP management plane: its coded rejections cross as
 * `RPCError`s carrying the kap-server wire codes, so memory and ipc behave
 * identically (a raw `Error2` would cross ipc as a generic 50001) and both
 * match `/api/v2/mcp` — `mcp.server_not_found` → 40408, `request.invalid` /
 * `config.invalid` → 40001, `mcp.oauth_failed` → 40929.
 */
function rethrowMcpManagementErrorAsRpc(error: unknown): never {
  if (error instanceof Error2) {
    switch (error.code) {
      case ErrorCodes.MCP_SERVER_NOT_FOUND:
        throw new RPCError(MCP_SERVER_NOT_FOUND, error.message, error.details);
      case ErrorCodes.REQUEST_INVALID:
      case ErrorCodes.CONFIG_INVALID:
        throw new RPCError(REQUEST_INVALID, error.message, error.details);
      case ErrorCodes.MCP_OAUTH_FAILED:
        throw new RPCError(MCP_OAUTH_FAILED, error.message, error.details);
    }
  }
  throw error;
}

/** Structural view of the engine's `IFileService` used by the wire adaptation. */
type FileServiceWireTarget = {
  save(source: Readable, filename: string, options?: SaveOptions): Promise<FileMeta>;
  get(fileId: string): Promise<GetResult>;
};

export function createMemoryDispatcher(root: ScopeLike): MemoryDispatcher {
  /** Mirrors kap-server's `resolveScope`, incl. main-agent materialization. */
  async function resolveScope(scope: ScopeRef): Promise<ResolvedScope> {
    if (scope.workspaceId !== undefined) {
      const workspace = await root.accessor
        .get(IWorkspaceInstanceManager)
        .getOrCreate({ workspaceId: scope.workspaceId });
      void workspace.program;
      return { kind: 'workspace', like: root };
    }
    if (scope.sessionId === undefined) return { kind: 'core', like: root };
    const session =
      root.accessor.get(ISessionManager).get(scope.sessionId) ??
      getLiveSessionById(root.accessor, scope.sessionId);
    if (session === undefined) {
      throw new RPCError(NOT_FOUND, `session not found: ${scope.sessionId}`);
    }
    if (scope.agentId === undefined) {
      return { kind: 'session', like: session, sessionId: scope.sessionId };
    }
    if (scope.agentId === 'main') {
      const context = await ensureMainAgent(session);
      const handle = session.accessor.get(IAgentLifecycleService).handleOf(context.agentId);
      if (handle === undefined) {
        throw new RPCError(NOT_FOUND, 'main agent was not found');
      }
      return { kind: 'agent', like: handle };
    }
    const agent = session.accessor.get(IAgentLifecycleService).handleOf(scope.agentId);
    if (agent === undefined) {
      throw new RPCError(NOT_FOUND, `agent not found: ${scope.agentId}`);
    }
    return { kind: 'agent', like: agent };
  }

  function sessionInteractionView(
    resolved: ResolvedScope,
    service: string,
  ): Record<string, unknown> | undefined {
    if (resolved.kind !== 'session') return undefined;
    const sessionId = resolved.sessionId as string;
    if (service === 'sessionInteractionService') return interactionServiceView(sessionId);
    if (service === 'sessionApprovalService') return approvalServiceView(sessionId);
    if (service === 'sessionQuestionService') return questionServiceView(sessionId);
    return undefined;
  }

  function resolveService(resolved: ResolvedScope, service: string): Record<string, unknown> {
    if (
      service === 'sessionInteractionService' ||
      service === 'sessionApprovalService' ||
      service === 'sessionQuestionService'
    ) {
      const view = sessionInteractionView(resolved, service);
      if (view === undefined) {
        throw new RPCError(
          REQUEST_INVALID,
          `service not available in ${resolved.kind} scope: ${service}`,
        );
      }
      return view;
    }
    if (service === 'agentSkillService') {
      if (resolved.kind !== 'agent') {
        throw new RPCError(
          REQUEST_INVALID,
          `service not available in ${resolved.kind} scope: ${service}`,
        );
      }
      return agentSkillServiceView(resolved.like as IAgentScopeHandle);
    }
    if (service === 'agentLoopService') {
      if (resolved.kind !== 'agent') {
        throw new RPCError(
          REQUEST_INVALID,
          `service not available in ${resolved.kind} scope: ${service}`,
        );
      }
      return agentLoopServiceView(resolved.like as IAgentScopeHandle);
    }
    const token = serviceTokens[service];
    if (token === undefined) {
      throw new RPCError(REQUEST_INVALID, `unknown service: ${service}`);
    }
    return resolved.like.accessor.get(token) as Record<string, unknown>;
  }

  /** Mirrors kap-server's WS `eventMap` per scope kind. */
  function subscribeStream(
    resolved: ResolvedScope,
    name: string,
    handler: (data: unknown) => void,
  ): IDisposable {
    if (resolved.kind === 'core' && name === 'events') {
      const bus = resolved.like.accessor.get(IEventService);
      return bus.subscribe((event) => {
        handler(wireClone(event));
      });
    }
    if (resolved.kind === 'session' && name === 'interactions') {
      const sessionId = resolved.sessionId as string;
      let last = pendingIdsOfSession(sessionId).join('');
      return {
        dispose: interactions.onDidChangePending(() => {
          const next = pendingIdsOfSession(sessionId).join('');
          if (next === last) return;
          last = next;
          handler(wireClone(pendingInteractionsOfSession(sessionId)));
        }),
      };
    }
    if (resolved.kind === 'session' && name === 'interactions:resolved') {
      const sessionId = resolved.sessionId as string;
      const known = new Set(pendingIdsOfSession(sessionId));
      const detachChange = interactions.onDidChangePending(() => {
        for (const id of pendingIdsOfSession(sessionId)) known.add(id);
      });
      const detachResolve = interactions.onDidResolve((resolution) => {
        if (!known.delete(resolution.id)) return;
        handler(wireClone(resolution));
      });
      return {
        dispose: () => {
          detachChange();
          detachResolve();
        },
      };
    }
    if (resolved.kind === 'agent' && name === 'events') {
      const bus = resolved.like.accessor.get(IEventBus);
      return bus.subscribe((event) => {
        handler(wireClone(event));
      });
    }
    throw new RPCError(REQUEST_INVALID, `unknown event stream: ${name} (${resolved.kind})`);
  }


  return createDispatcher({
    resolveScope,
    resolveService,
    subscribe: subscribeStream,

    async handleCall(resolved, service, method, args, instance) {
      void resolved;
      if (service === 'fileService' && method === 'save') {
        const [data, filename, options] = args as [string, string, SaveOptions | undefined];
        const files = instance as FileServiceWireTarget;
        try {
          const meta = await files.save(
            Readable.from(Buffer.from(data, 'base64')),
            filename,
            options,
          );
          return { handled: true, value: wireClone(meta) };
        } catch (error) {
          rethrowFileErrorAsRpc(error);
        }
      }
      if (service === 'fileService' && method === 'get') {
        const [fileId] = args as [string];
        const files = instance as FileServiceWireTarget;
        try {
          const { meta, stream } = await files.get(fileId);
          const chunks: Buffer[] = [];
          for await (const chunk of stream()) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
          }
          return {
            handled: true,
            value: { meta: wireClone(meta), data: Buffer.concat(chunks).toString('base64') },
          };
        } catch (error) {
          rethrowFileErrorAsRpc(error);
        }
      }
      return { handled: false };
    },

    streamIterable(_resolved, service, method, args, instance) {
      if (service !== 'modelResolver' || method !== 'generate') return undefined;
      const [modelId, input, params] = args;
      const controller = new AbortController();
      return {
        [Symbol.asyncIterator]() {
          const iterator = (
            instance as {
              generate(
                id: string,
                input: unknown,
                signal: AbortSignal,
                params: unknown,
              ): AsyncIterable<unknown>;
            }
          )
            .generate(modelId as string, wireClone(input), controller.signal, wireClone(params))
            [Symbol.asyncIterator]();
          return {
            async next() {
              const result = await iterator.next();
              if (result.done) return { done: true, value: undefined };
              return { done: false, value: wireClone(result.value) };
            },
            async return(value?: unknown) {
              controller.abort();
              await iterator.return?.(value);
              return { done: true as const, value: undefined };
            },
          };
        },
      };
    },

    adaptCallArgs(resolved, service, args) {
      const cloned = args.map(wireClone);
      return AGENT_CONTEXT_SERVICES.has(service)
        ? [agentContextOf(resolved.like as IAgentScopeHandle), ...cloned]
        : cloned;
    },

    mapCallError(service, error) {
      if (service === 'modelsDevImport' && error instanceof Error2) {
        throw new RPCError(REQUEST_INVALID, error.message, error.details);
      }
      if (service === MCP_MANAGEMENT_SERVICE) {
        rethrowMcpManagementErrorAsRpc(error);
      }
      if (error instanceof Error2 && error.code === ErrorCodes.PROMPT_ID_CONFLICT) {
        throw new RPCError(PROMPT_ID_CONFLICT, error.message, error.details);
      }
    },
  });
}
