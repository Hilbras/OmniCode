# Client surfaces — what a first-class OmniCode client is

Status: active. This is the foundation for the Desktop, Mobile and Web surfaces: one
contract every client follows, so the kernel stays lightweight and the daemon logic is
never duplicated per surface.

## The rule

A surface is a **client of the daemon**, never a consumer of kernel internals.

- Talk to the running daemon through the shared client: `createOmnicodeWebApi` from
  `@hilbras/app-core/api` (what `apps/omnicode-web` uses) or the SDK
  (`@hilbras/omnicode-sdk`) where a programmatic surface fits better.
- Do not import `@hilbras/omnicode-engine` or `@hilbras/omnicode-core` to reach services
  directly. The daemon owns scopes, sessions, permissions and persistence; a surface
  that reaches past it forks behaviour and breaks the single-writer assumption.
- Do not grow a second transport. REST for request/response, the daemon event socket for
  streamed events — both already published by the shared client.

## What every client must provide

| Concern | Contract | Notes |
|---|---|---|
| Identity | `ClientIdentity` (`clientId`, `clientName`, `clientVersion`, `clientUiMode`) | `clientUiMode` is how the daemon distinguishes `web`, `mobile`, `desktop`, `cli`; the daemon must not infer it from the transport |
| Credentials | `CredentialStore.getToken()` | Per-platform secure storage: Keychain/Keystore equivalents on desktop and mobile, `localStorage` only for the in-tree web app. A token never travels in a URL or a log |
| Tracing | `Tracer` (`noopTracer` acceptable) | Telemetry must not emit paths, env values, tokens or raw error text |
| Translation | `Translator` | A surface passes its own bundle; the daemon returns keys |

## Surface status

- **Web** — `apps/omnicode-web` (React 19 + Vite) is the in-tree first-class client: it
  rides `app-core`'s API, its pagination rules are unit-tested, and it is part of the
  root test graph. It is the reference implementation of this contract.
- **Mobile** — `apps/omnicode-mobile` (Expo/React Native) is the on-device client. It
  uses the same client contract; secure storage replaces the web's `localStorage`.
  `apps/omnicode-mobile.old` is retired and is not a client.
- **Desktop** — not built. A desktop client would reuse this contract unchanged: same
  identity, same API, same event socket, with OS keychain storage and a native file
  picker. No desktop-specific daemon behaviour is planned, and nothing in the engine is
  shaped around a desktop process today.

## Plugins

Plugins are declarative contributions to the daemon, not code that runs in a surface:

- A plugin manifest (`omnicode.plugin.json` or `.omnicode-plugin/plugin.json`) may
  contribute skills, agents, MCP servers, hooks and commands — and nothing executable
  (`tools`, `apps`, `inject`, `bootstrap` are rejected by the parser).
- `permissions` is required for each executable surface it uses (`hooks`, `commands`,
  `mcpServers`); under-declaring is an error and the plugin contributes nothing.
- `engines.omnicode` is a semver range checked at load. Until a surface injects its own
  version, the host version is the core (`packages/base`) version, so ranges must target
  that value; the CLI/desktop/mobile can pass `hostVersion` to `parseManifest`.
- The Marketplace is deliberately out of scope: nothing here indexes, prices or installs
  third-party plugins beyond the existing source resolver.
