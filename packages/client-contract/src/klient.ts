/**
 * The transport-agnostic klient shape. Every transport entry point
 * (`@hilbras/omnicode-api/ipc|memory`) builds a `KlientChannel` and hands it
 * to `createKlientFromChannel` in `@hilbras/omnicode-api`; the returned
 * `Klient` is identical in shape and behavior no matter which transport
 * carried the bytes. This module owns only the shape, so the ACP host can
 * consume a klient without depending on the API package that implements it.
 */

import type { AgentEventPayloads } from './contract/agent/events.js';
import type { KlientEventPayloads } from './contract/global/events.js';
import type { SessionEventPayloads } from './contract/session/events.js';
import type { KlientEvents } from './events.js';
import type { AgentFacade } from './facade-agent.js';
import type { GlobalFacade } from './facade-global.js';
import type { SessionFacade } from './facade-session.js';

export interface KlientOptions {
  /**
   * Validate wire inputs/outputs and event payloads against the contract.
   * Default `true`. Disable only on measured hot paths — validation is cheap
   * (sub-µs for typical payloads) and is the drift tripwire.
   */
  readonly validate?: boolean;
}

export interface SessionHandle extends SessionFacade {
  readonly events: KlientEvents<SessionEventPayloads>;
  agent(agentId: string): AgentHandle;
}

export interface AgentHandle extends AgentFacade {
  readonly events: KlientEvents<AgentEventPayloads>;
}

export interface Klient {
  readonly global: GlobalFacade;
  readonly events: KlientEvents<KlientEventPayloads>;
  session(sessionId: string): SessionHandle;
  close(): Promise<void>;
}
