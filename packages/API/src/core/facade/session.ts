/**
 * The session facade — one `klient.session(id)` handle aggregating the
 * session-scope services (metadata, activity, approvals, questions,
 * interactions) plus the app-scope lifecycle service for close/archive/
 * restore/delete/fork/createChild. `agents()` reads the metadata registry (agent
 * handles are not serializable, so no agent-lifecycle channel exists on the
 * wire).
 */

import type { ApprovalRequest } from '@hilbras/omnicode-engine/agent/interaction/approval';
import type { Interaction } from '@hilbras/omnicode-engine/human/interaction/interaction';
import type { QuestionRequest } from '@hilbras/omnicode-engine/agent/interaction/question';
import type { SessionMeta } from '@hilbras/omnicode-engine/session/sessionMetadata/sessionMetadata';
import type { SkillSummary } from '@hilbras/omnicode-engine/features/skill/catalog/types';

import type { ScopeRef } from '@hilbras/omnicode-rpc/channel';
import type { SessionFacade } from '@hilbras/omnicode-client-contract';
import type { ScopedCaller } from './global.js';

export type * from '@hilbras/omnicode-client-contract/facade-session';
export type { ScopedCaller } from './global.js';

/** What `sessionLifecycleService.create` and `sessionManager.restore` leave on the wire. */
interface HandleWire {
  readonly id: string;
}

export function createSessionFacade(call: ScopedCaller, sessionId: string): SessionFacade {
  const scope: ScopeRef = { sessionId };
  const read = (): Promise<SessionMeta> =>
    call(scope, 'sessionMetadata', 'read', []) as Promise<SessionMeta>;
  const spawn = async (
    method: 'fork' | 'createChild',
    input: { title?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<SessionMeta> => {
    return call({}, 'sessionManager', method, [
      { sourceSessionId: sessionId, title: input.title, metadata: input.metadata },
    ]) as Promise<SessionMeta>;
  };

  return {
    get: read,
    setTitle: (title) => call(scope, 'sessionMetadata', 'setTitle', [title]) as Promise<void>,
    generateTitle: (opts) =>
      call(scope, 'sessionTitleService', 'generateTitle', [opts]) as Promise<
        string | undefined
      >,
    update: (patch) => call(scope, 'sessionMetadata', 'update', [patch]) as Promise<void>,
    setArchived: (archived) =>
      call(scope, 'sessionMetadata', 'setArchived', [archived]) as Promise<void>,
    status: async () => {
      const activity = (await call(scope, 'sessionActivityView', 'state', [])) as {
        readonly busy: boolean;
        readonly pendingInteraction: 'none' | 'approval' | 'question';
      };
      if (activity.pendingInteraction === 'approval') return 'awaiting_approval';
      if (activity.pendingInteraction === 'question') return 'awaiting_question';
      return activity.busy ? 'running' : 'idle';
    },
    close: () => call({}, 'sessionManager', 'close', [sessionId]) as Promise<void>,
    archive: () => call({}, 'sessionManager', 'archive', [sessionId]) as Promise<void>,
    restore: async (opts) => {
      const handle = (await call({}, 'sessionManager', 'restore', [sessionId, opts])) as HandleWire | null;
      return handle !== null && handle !== undefined;
    },
    delete: () => call({}, 'sessionManager', 'delete', [sessionId]) as Promise<void>,
    fork: (input) => spawn('fork', input),
    createChild: (input) => spawn('createChild', input),

    approvals: {
      list: () =>
        call(scope, 'sessionApprovalService', 'listPending', []) as Promise<
          readonly ApprovalRequest[]
        >,
      decide: (id, response) =>
        call(scope, 'sessionApprovalService', 'decide', [id, response]) as Promise<void>,
    },

    questions: {
      list: () =>
        call(scope, 'sessionQuestionService', 'listPending', []) as Promise<
          readonly QuestionRequest[]
        >,
      answer: (id, result) =>
        call(scope, 'sessionQuestionService', 'answer', [id, result]) as Promise<void>,
      dismiss: (id) => call(scope, 'sessionQuestionService', 'dismiss', [id]) as Promise<void>,
    },

    interactions: {
      list: (kind) =>
        call(scope, 'sessionInteractionService', 'listPending', [kind]) as Promise<
          readonly Interaction[]
        >,
      respond: (id, response) =>
        call(scope, 'sessionInteractionService', 'respond', [id, response]) as Promise<void>,
    },

    skills: {
      list: () =>
        call(scope, 'sessionSkillCatalog', 'list', []) as Promise<readonly SkillSummary[]>,
    },

    agents: async () => {
      const meta = await read();
      return meta.agents ?? {};
    },
  };
}
