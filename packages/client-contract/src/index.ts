/**
 * Client-facing contract types shared by the OmniCode API daemon
 * (`@hilbras/omnicode-api`) and the ACP host (`@hilbras/omnicode-acp`).
 *
 * This package exists to break the API ↔ ACP build cycle: API owns the daemon and the
 * ACP loader, ACP consumes a klient, and both need the same client-facing types. Those
 * types lived in API, so ACP had to depend on API. They live here now — the single
 * source both sides import — which is the "extract shared contracts" half of the
 * decision recorded in `docs/plans/strength-program.md`.
 *
 * The wire contracts under `src/contract/` are the source for API's implementations
 * and for API's generated `docs/wire-contract.json`; runtime accessors such as
 * `globalContract` stay on the `./contract/index` subpath.
 */
export type * from './contract/agent/events.js';
export type * from './contract/global/events.js';
export type * from './contract/mcp.js';
export type * from './contract/session/events.js';
export type * from './events.js';
export type * from './facade-agent.js';
export type * from './facade-global.js';
export type * from './facade-session.js';
export type * from './klient.js';
export type * from './kosong-types.js';
