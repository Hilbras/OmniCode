# packages/Kaos — Agent Guide

Read the root `AGENTS.md` first. This directory is a leaf package; the package
name is `@hilbras/omnicode-kaos` (`kaos` in the layering guard).
## Role and non-goals

Execution-environment abstraction: one `Kaos` interface over local and SSH
filesystems/processes, plus environment probing, path/glob behavior, text
decoding, login-shell PATH bridging, a current-environment binding, and
OS-sandbox execution plumbing.

Non-goals: no agent policy, permission-mode decisions, workspace trust,
command allowlists, or remote-host configuration management. The sandbox layer
validates argv and can require argv mode, but it does not decide whether an
agent action is approved. Callers decide whether a command may run; `Kaos`
executes it.
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
- Sandbox: `probeBwrap`, `probeLandlock`, `BwrapSandboxBackend`,
  `LandlockSandboxBackend`, `createSandboxBackend`, `buildBwrapArgv`,
  `evaluateRuntimeShellPolicy`, `createSandboxExecutionPlan`,
  `selectSandboxBackend`, `createSandboxStatus`, `summarizeSandboxPolicy`,
  `SandboxFileWorker`, `createNodeFileWorkerFs`, `parseFileWorkerRequest`,
  `isSandboxPathContained`, `resolveSandboxPath`, `normalizeSandboxRoot`, and
  the sandbox result/availability/policy types.

`SSHKaos` is not on the root barrel. Import it from
`@hilbras/omnicode-kaos/ssh`.

Key files:

- `src/kaos.ts`: the environment contract.
- `src/local.ts`: `LocalKaos`, `LocalProcess`, local glob/read/write behavior.
- `src/ssh.ts`: `SSHKaos`, SFTP, remote process execution, quoting.
- `src/current.ts`: `AsyncLocalStorage` current-instance binding.
- `src/environment.ts`, `src/login-shell-path.ts`, `src/shell-path-bridge.ts`.
- `src/internal.ts`: buffered streams, decode-with-errors, glob regex.
- `src/sandbox/types.ts`: backend, availability, policy, failure, status types.
- `src/sandbox/availability.ts`: injected `bwrap` / landlock probes.
- `src/sandbox/bwrap.ts`, `src/sandbox/backends.ts`: safe bwrap argv and
  backend adapters.
- `src/sandbox/shell-policy.ts`, `src/sandbox/execution.ts`: argv validation
  and execution-plan construction.
- `src/sandbox/paths.ts`, `src/sandbox/file-worker.ts`: containment and the
  staged file-worker protocol.
- `src/sandbox/selection.ts`, `src/sandbox/status.ts`: pure backend selection
  and diagnostics.
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
- Sandbox argv is always `bwrap` plus an argument array. Never build a shell
  string. The workspace is bound read-write, system paths read-only, and the
  network is unshared unless policy explicitly shares it.
- `probeBwrap` runs only `bwrap --version` and a fixed
  `bwrap --unshare-all ... /bin/true` probe. Tests must inject the probe seam
  and never execute real `bwrap` or landlock syscalls.
- Landlock has no pure-TypeScript syscall bridge. `LandlockSandboxBackend`
  reports unavailable with a reason and falls back to bwrap; do not fabricate
  enforcement.
- The file worker stages writes and applies them on `commit`; `abort` discards
  staged writes. Enforce lexical containment plus `realpath` containment when
  the filesystem backend exposes it, and keep payload/read/list bounds.
- Sandbox permission selection is a pure function. Permission-mode approval
  stays in the engine; do not import engine policy here.
## Tests
Test root: `packages/Kaos/test/`, with setup that creates a `LocalKaos` and
binds it in `beforeEach`. Vitest project: `kaos`. No `test` script exists.
```bash
pnpm --filter @hilbras/omnicode-kaos exec vitest run
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/local.test.ts
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/e2e
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/sandbox
pnpm --filter @hilbras/omnicode-kaos typecheck
```
`test/e2e/` includes real local filesystem/process tests (concurrency, glob
parity, lifecycle, large stdout) plus SSH validation/mocked-SFTP tests, not a
live SSH server. Some tests skip on Windows (`kill`, symlinks).
`test/fixtures/killtree.cjs` supports process-tree tests.
`test/sandbox/` covers bwrap argv shape, availability/failure states, shell
policy, file-worker commit/abort, path and symlink containment, and selection.
It uses injected probes and an in-memory filesystem; it never runs real
sandboxing tools.
## Local traps

- Directory casing is `Kaos`; package name is lowercase `kaos`; Vitest project
  name is also `kaos`.
- SSH is a subpath export only. Importing it from the root fails.
- Sandbox backends exist under `src/sandbox/`, but `LocalKaos.exec` remains
  unsandboxed. Callers must build an execution plan and spawn `bwrap` through
  `Kaos` themselves.
- Do not confuse this with `base/src/execEnv` (environment-agnostic probing).
- Tests bind via `enterWith` in `beforeEach`; an `await` there breaks
  inheritance.
## Belongs here vs neighbours
- Command permission analysis: `engine` plus
  `@hilbras/omnicode-tree-sitter-bash`.
- Bare-command trust, workspace trust, and sandbox-vs-permission-mode wiring:
  `engine`/host.
- Transport channels: `rpc`. Agent tools calling this: `Tools`/`engine`.


## Sandbox subpath

`@hilbras/omnicode-kaos/sandbox` is the public sandbox surface for host adapters. Root `index.ts` also re-exports it for existing consumers.


The `@hilbras/omnicode-kaos/sandbox` surface is consumed by the Bash tool through `OMNICODE_SANDBOX_MODE` (`off`, `auto`, `required`). It never grants approval; it only executes an already-approved command under bwrap when available.


## Write allowlists

`SandboxPolicy.writeAllowlist` binds the workspace read-only and exposes only listed contained paths RW via `--bind-try`. Undefined preserves whole-workspace RW. Bash reads optional absolute roots from `OMNICODE_SANDBOX_WRITE_ROOTS`.

## Seatbelt backend

`src/sandbox/seatbelt.ts` builds a deny-by-default `sandbox-exec` profile for macOS: writes only under the workspace (or a contained `writeAllowlist`), system paths read-only, network only when `shareNetwork`. Literals only — paths are escaped, never interpolated as rules. `probeSeatbelt` is honest (non-darwin, missing probe, and real probe result) and never claims enforcement without a probe.
