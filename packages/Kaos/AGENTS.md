# packages/Kaos — Agent Guide

Read the root `AGENTS.md` first. This directory is a leaf package; the package
name is `@hilbras/omnicode-kaos` (`kaos` in the layering guard).
## Role and non-goals

Execution-environment abstraction: one `Kaos` interface over local and SSH
filesystems/processes, plus environment probing, path/glob behavior, text
decoding, login-shell PATH bridging, and a current-environment binding.

Non-goals: no agent policy, permission decisions, workspace trust, command
allowlists, shell parsing, or remote-host configuration management. Callers
decide whether a command may run; `Kaos` executes it.
## Entry points and modules

Root `src/index.ts` exports:

- `Kaos`, `KaosProcess`, `StatResult`, `Environment`.
- `LocalKaos` and `detectEnvironment` / `detectEnvironmentFromNode`.
- Current-context helpers: `getCurrentKaos`, `setCurrentKaos`, `runWithKaos`,
  and module-level `readText`, `writeText`, `readLines`, `readBytes`,
  `writeBytes`, `stat`, `mkdir`, `iterdir`, `glob`, `chdir`, `getcwd`,
  `gethome`, `normpath`, `exec`, `execWithEnv`.
- Shell-path bridge: `createShellPathBridge`, `getShellPathBridge`,
  `translateShellDrivePath`.
- Errors: `KaosError`, `KaosValueError`, `KaosFileExistsError`,
  `KaosShellNotFoundError`.

`SSHKaos` is not on the root barrel. Import it from
`@hilbras/omnicode-kaos/ssh`.

Key files:

- `src/kaos.ts`: the environment contract.
- `src/local.ts`: `LocalKaos`, `LocalProcess`, local glob/read/write behavior.
- `src/ssh.ts`: `SSHKaos`, SFTP, remote process execution, quoting.
- `src/current.ts`: `AsyncLocalStorage` current-instance binding.
- `src/environment.ts`, `src/login-shell-path.ts`, `src/shell-path-bridge.ts`.
- `src/internal.ts`: buffered streams, decode-with-errors, glob regex.
## Layering rules

- Leaf law: no `@hilbras/omnicode-*` imports.
- Runtime dependencies are `pathe` and `ssh2`; SSH types are dev-only.
- Do not import `base` helpers. Environment-agnostic utilities stay in `base`;
  this package owns only the environment abstraction.
## Local constraints

- Path semantics are per environment: `pathClass()` is `posix` or `win32`.
  Relative paths resolve against that instance's `cwd`, including after
  `chdir` on SSH. Normalize with `pathe`, not raw string comparison.
- `LocalKaos.exec(...args)` and `execWithEnv(args, env)` spawn with an argument
  array. Never introduce a shell-string overload for local execution.
- SSH must quote every argument and environment assignment (`shellQuote`).
  `extraOptions` may not override managed connection fields.
- `KaosProcess` owns piped stdio and lifecycle (`wait`, `kill`, `dispose`).
  `wait()` is expected to be repeatable; do not add unmanaged listeners.
- Text reading supports `strict`, `replace`, and `ignore`; keep local and SSH
  behavior aligned.
- The current binding is async-context scoped. Bind once at startup or use
  `runWithKaos` for an isolated subtree; do not add a mutable global singleton.
- Workspace trust and `resolveCommandPath` are caller responsibilities. This
  package does no PATH trust check before spawn.
## Tests
Test root: `packages/Kaos/test/`, with setup that creates a `LocalKaos` and
binds it in `beforeEach`. Vitest project: `kaos`. No `test` script exists.
```bash
pnpm --filter @hilbras/omnicode-kaos exec vitest run
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/local.test.ts
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/e2e
pnpm --filter @hilbras/omnicode-kaos typecheck
```
`test/e2e/` includes real local filesystem/process tests (concurrency, glob
parity, lifecycle, large stdout) plus SSH validation/mocked-SFTP tests, not a
live SSH server. Some tests skip on Windows (`kill`, symlinks).
`test/fixtures/killtree.cjs` supports process-tree tests.
## Local traps

- Directory casing is `Kaos`; package name is lowercase `kaos`; Vitest project
  name is also `kaos`.
- SSH is a subpath export only. Importing it from the root fails.
- Keywords mention sandbox, but only `LocalKaos` and `SSHKaos` exist; there is
  no container/sandbox backend here.
- Do not confuse this with `base/src/execEnv` (environment-agnostic probing).
- Tests bind via `enterWith` in `beforeEach`; an `await` there breaks
  inheritance.
## Belongs here vs neighbours
- Command permission analysis: `engine` plus
  `@hilbras/omnicode-tree-sitter-bash`.
- Bare-command trust and workspace trust: `engine`/host.
- Transport channels: `rpc`. Agent tools calling this: `Tools`/`engine`.
