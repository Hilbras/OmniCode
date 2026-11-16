# packages/base — Agent Guide

Read the root `AGENTS.md` first. `base` is a leaf package.
## Role and non-goals

Foundation for the kernel: dependency injection, scopes and fibers, collections,
lifecycle ledgers, events, logging, redaction, contribution/state registries,
path/glob/exec-environment utilities, and error serialization.

Non-goals: no agent loop, services, tools, provider wires, sessions, config
loading, or app surfaces. Those live in `engine`, `llm`, `auth`, or apps.
## Entry points and modules

There is no root barrel: `src/index.ts` is empty. Do not import
`@hilbras/omnicode-base` and expect exports. The package maps `./*` to
`src/*.ts`, so consumers import concrete subpaths:

```ts
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { InstantiationService } from '@hilbras/omnicode-base/di/instantiationService';
import { LifecycleScope, createAppScope } from '@hilbras/omnicode-base/di/scope';
import { Service } from '@hilbras/omnicode-base/di/service';
import { Ledger } from '@hilbras/omnicode-base/lifecycle/ledger';
import { ILogService } from '@hilbras/omnicode-base/log/log';
import { createServices, createScopedTestHost } from '@hilbras/omnicode-base/di/test';
```

Important areas:

- `src/di/`: service identifiers, `ServiceCollection`, `InstantiationService`,
  scopes (`App`/`Session`/`Agent`), fibers, collection/definition tokens,
  cascade engine, dependency graph, test instantiation helpers.
- `src/lifecycle/`: `Disposable`, `DisposableStore`, `Ledger`, effect teardown,
  lifecycle transitions. A ledger owns teardown for its unit/scope.
- `src/event.ts`, `src/contribution/registry.ts`, `src/state/stateRegistry.ts`:
  events, ordered contributions, and typed state keys.
- `src/log/` and `src/text/redaction.ts`: logging plus secret redaction.
- `src/execEnv/`, `src/utils/`: host probing, login-shell PATH, glob conversion,
  decoding, paths, env parsing, retry, abort, canonical args, file metadata.

Inside `src`, `#/*` maps to `./src/*.ts` (`#/di/service`). Some modules use
relative imports; follow the file.
## Layering rules

- Leaf law: import no other `@hilbras/omnicode-*` package.
- Runtime dependencies are `js-yaml`, `undici`, and `zod`; test helpers use
  `sinon`.
- Do not add a new barrel to simplify consumption. Add a concrete module and
  import its subpath.
## Local constraints

- Scoped registrations are global and duplicate registration throws. Use
  `overrideScopedService` only for intentional replacement.
- Effects and disposers can be async. Register cleanup with the owning
  `Ledger`/scope instead of process handlers or unmanaged timers.
- Logs and error payloads must redact secrets with `text/redaction.ts`. Never
  log tokens, credentials, or raw env dumps.
- Path helpers normalize Windows/POSIX differences (`resolvePath`,
  `normalizeSlashes`, `findUpwardRoot`). Do not compare raw path strings.
- `di/testInstantiationService.ts`, `di/test.ts`, and `sinon` are test-only
  surfaces. Do not make production code depend on them.
- `getCoreVersion()` reads the package's real `package.json` version through
  `createRequire(import.meta.url)` and falls back to `'0.0.0'` only when the
  manifest is unreadable; it is not a static placeholder. The engine test
  `packages/engine/test/_base/version.test.ts` pins the value against
  `packages/base/package.json`.
## Tests
Test root: `packages/base/test/`. Vitest project name: `omnicode-base`. Exactly
one package-local test exists: `test/asyncEventQueue.test.ts`. The DI container,
fibers, scopes, ledger, logging, redaction, and path helpers have no
package-local tests; downstream packages exercise them through
`@hilbras/omnicode-base/di/test` and direct subpath imports.

```bash
pnpm --filter @hilbras/omnicode-base test
pnpm --filter @hilbras/omnicode-base exec vitest run test/asyncEventQueue.test.ts
pnpm --filter @hilbras/omnicode-base typecheck
```

Do not describe the full package as covered; only the async event queue has
local tests.
## Local traps

- `src/index.ts` being empty is load-bearing: adding exports there creates a
  different public entry point than the wildcard subpaths.
- Every `src/*.ts` file is already reachable as a public subpath through
  `exports`; treat new files as API.
- The standalone `tsconfig.json` uses `ES2024`, `module: preserve`, and
  `experimentalDecorators`; it does not extend the root config.
## Belongs here vs neighbours

- Transport/channels: `rpc`. Process/filesystem abstraction: `Kaos`.
- Provider protocol work: `llm`. Transcript models: `transcript`.
- Agent services, tools, permissions, sessions: `engine`.
