# packages/auth — Agent Guide

Read the root `AGENTS.md` first. `auth` is a leaf package.
## Role and non-goals

Managed Omnicode authentication primitives: OAuth Device Code Flow, token
persistence and refresh, managed provider provisioning, model discovery,
regions, identity headers, usage/user-info/feedback calls, and shared provider
credential rules.

Non-goals: no CLI/TUI prompts, no concrete config-file implementation, no agent
sessions, and no LLM calls. Hosts supply a config adapter and surface the user
code themselves.
## Entry points

- Root `@hilbras/omnicode-auth` (`src/index.ts`) is the Node-capable surface:
  `OAuthManager`, `FileTokenStorage`, `OmnicodeOAuthToolkit`, managed config
  helpers, region helpers, identity helpers, usage/user-info/feedback/tools.
- `@hilbras/omnicode-auth/device` is the browser-safe surface. It must remain
  free of `node:fs`, `node:os`, `node:crypto`, and `proper-lockfile`; browser
  callers run request → display URI → poll themselves.
- `@hilbras/omnicode-auth/provider-credential` holds the shared precedence and
  conflict rules for `apiKey` / `apiKeyEnv` / `oauth`.
- Internal imports use the `#/*` alias to `src/*.ts`.

Important modules:

- `oauth.ts`: HTTP wrappers for device authorization, polling, refresh.
- `oauth-manager.ts`: token lifecycle, lazy refresh, local mutex, cross-process
  lock, revoked tombstones.
- `storage.ts`: `FileTokenStorage` under `credentials/<name>.json`.
- `token-state.ts`: internal valid/revoked/missing distinction.
- `managed-omnicode.ts`, `toolkit.ts`: managed provider provisioning and host
  orchestration through `OmnicodeOAuthToolkit`.
- `discover-models.ts`, `custom-registry.ts`, `open-platform.ts`,
  `model-alias-merge.ts`, `managed-tools.ts`, `managed-usage.ts`,
  `managed-userinfo.ts`, `managed-feedback*.ts`, `region.ts`, `identity.ts`.
## Layering rules

- Leaf law: import no other `@hilbras/omnicode-*` package.
- Runtime dependencies are `zod` and `proper-lockfile`; do not add `base` or
  `engine` for convenience.
- `device` must stay browser-safe. Anything importing a Node builtin belongs
  behind the root entry.
## Local constraints

- In-process token types are camelCase (`accessToken`); persisted/wire tokens
  are snake_case (`access_token`). Convert with `tokenToWire`/`tokenFromWire`.
- `FileTokenStorage` is atomic: temp → fsync → rename, mode `0600`, parent
  `0700`. It rejects non-basename token names to prevent traversal. Do not
  weaken either rule.
- Missing and revoked tokens differ. A revoked record is a tombstone with empty
  credentials so a new process says "re-authenticate", not "never logged in".
- Refresh is coalesced in-process and coordinated cross-process with
  `proper-lockfile`. Production callers must pass `configDir`; missing it
  disables the lock. Keep injectable clock/sleep/fetch/storage seams.
- Preserve error categories: 401/403 → `OAuthUnauthorizedError`, denial →
  `OAuthAccessDeniedError`, transport → `OAuthConnectionError`, 429/5xx →
  `RetryableRefreshError`, device TTL → `DeviceCodeExpiredError`.
- Managed provisioning writes only through the supplied config adapter. Do not
  read or mutate `config.toml` directly here.
- Never log raw tokens or authorization headers.
## Tests
Test root: `packages/auth/test/`. The package has a `test` script (`vitest run`),
so the root Turbo graph runs the suite; it did not until that script existed.
Project is `omnicode-oauth`, not `omnicode-auth`. 21 files, 376 tests.
```bash
pnpm --filter @hilbras/omnicode-auth test
pnpm --filter @hilbras/omnicode-auth exec vitest run test/oauth-manager.test.ts
pnpm --filter @hilbras/omnicode-auth typecheck
```
Coverage includes storage, refresh, flows, locking, identity, region, managed
config/usage/user-info/feedback/tools, registry, discovery, and
`provider-credential`; multi-process `tsx` tests are slow; the example is a
manual smoke, not a test.
## Local traps

- The project name is `omnicode-oauth`; filtering by `omnicode-auth` selects
  nothing.
- Root exports only `.`, `./device`, and `./provider-credential`. Other modules
  are internal even though they live in `src/`.
- `OMNICODE_PROVIDER_NAME` is `managed:omnicode`; the default OAuth key is
  `oauth/omnicode`. Do not derive either from a directory name.
- `README.md` is minimal; source/tests are the contract. Use `region.ts` for
  hosts/base URLs, not a hardcoded host.
## Belongs here vs neighbours
- Provider wire selection/model calls: `llm`.
- Login/logout screens and command UX: `apps/omnicode-cli`.
- Managed config application: `auth` defines the adapter; the host owns the
  concrete config file.
- Agent permissions: `engine`, never inferred from OAuth scope.
