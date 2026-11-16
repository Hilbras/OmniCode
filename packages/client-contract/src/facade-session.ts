/**
 * The session facade — one `klient.session(id)` handle aggregating the
 * session-scope services (metadata, activity, approvals, questions,
 * interactions) plus the app-scope lifecycle service for close/archive/
 * restore/delete/fork/createChild. `agents()` reads the metadata registry (agent
 * handles are not serializable, so no agent-lifecycle channel exists on the
 * wire).
 */

import type {
  ApprovalRequest,
  ApprovalResponse,
} from '@hilbras/omnicode-engine/agent/interaction/approval';
import type {
  Interaction,
  InteractionKind,
} from '@hilbras/omnicode-engine/human/interaction/interaction';
import type {
  QuestionRequest,
  QuestionResult,
} from '@hilbras/omnicode-engine/agent/interaction/question';
import type {
  AgentMeta,
  SessionMeta,
  SessionMetaPatch,
} from '@hilbras/omnicode-engine/session/sessionMetadata/sessionMetadata';
import type { SkillSummary } from '@hilbras/omnicode-engine/features/skill/catalog/types';

import type { McpServerConfig } from './contract/mcp.js';

/**
 * Options for `SessionFacade.restore` — mirrors the engine's
 * `ResumeSessionOptions`. `mcpServers` injects ephemeral per-session MCP
 * servers when restore re-materializes a cold session (ignored when the
 * session is already live).
 */
export interface SessionRestoreOptions {
  readonly additionalDirs?: readonly string[];
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
}

export interface SessionApprovalsFacade {
  list(): Promise<readonly ApprovalRequest[]>;
  decide(id: string, response: ApprovalResponse): Promise<void>;
}

export interface SessionQuestionsFacade {
  list(): Promise<readonly QuestionRequest[]>;
  answer(id: string, result: QuestionResult): Promise<void>;
  dismiss(id: string): Promise<void>;
}

export interface SessionInteractionsFacade {
  list(kind?: InteractionKind): Promise<readonly Interaction[]>;
  respond(id: string, response: unknown): Promise<void>;
}

export interface SessionSkillsFacade {
  /**
   * Every skill in the session-merged catalog as a plain summary (the
   * catalog's readiness is resolved engine-side). Subscribe to
   * `session.events` `'skills.changed'` for updates.
   */
  list(): Promise<readonly SkillSummary[]>;
}

/**
 * Derived session lifecycle phase. The facade reads the engine's session
 * activity view (busy + pending interaction) and maps it onto the v1
 * precedence: pending approvals and questions first, then busy, then idle.
 */
export type SessionStatus = 'running' | 'idle' | 'awaiting_approval' | 'awaiting_question';

export interface SessionFacade {
  get(): Promise<SessionMeta>;
  setTitle(title: string): Promise<void>;
  /**
   * Generate and apply a title from the main agent's first prompts via the
   * managed `chat_title` tool. `undefined` when generation is unavailable
   * (no managed OAuth login, no prompt yet, or a custom title is set).
   * `force` regenerates anyway, overwriting a generated or custom title.
   * `source` picks the conversation excerpt: `user_prompts` (default),
   * `first_turn` (opening prompt + first reply; strict), or `digest`
   * (head+tail of a multi-turn conversation).
   */
  generateTitle(opts?: {
    force?: boolean;
    source?: 'user_prompts' | 'first_turn' | 'digest';
  }): Promise<string | undefined>;
  update(patch: SessionMetaPatch): Promise<void>;
  setArchived(archived: boolean): Promise<void>;
  status(): Promise<SessionStatus>;
  close(): Promise<void>;
  archive(): Promise<void>;
  /** Re-materialize a closed session; `false` when it no longer exists. */
  restore(opts?: SessionRestoreOptions): Promise<boolean>;
  /** Permanently delete the session and its persisted data; throws when missing. */
  delete(): Promise<void>;
  fork(input?: { title?: string; metadata?: Record<string, unknown> }): Promise<SessionMeta>;
  createChild(input?: { title?: string; metadata?: Record<string, unknown> }): Promise<SessionMeta>;
  readonly approvals: SessionApprovalsFacade;
  readonly questions: SessionQuestionsFacade;
  readonly interactions: SessionInteractionsFacade;
  readonly skills: SessionSkillsFacade;
  /** Agent id → metadata for every agent registered in this session. */
  agents(): Promise<Readonly<Record<string, AgentMeta>>>;
}
