# Tools — built-in agent tools

## Role and non-goals

`@hilbras/omnicode-tools` ships the built-in tools the model can call:
filesystem (`Read`, `Write`, `Edit`, `Glob`, `Grep`), shell (`Bash`), document
extraction, `WebSearch`, `FetchURL`, `AskUserQuestion`, `SelectTools`,
`RestoreFile`, feature tools for plan, goal, cron, swarm, todo, notify, and
skill, plus code intelligence (`Lsp`), git worktrees (`WorktreeList`,
`WorktreeCreate`, `WorktreeRemove`), notebooks (`NotebookEdit`), shared task
boards (`TaskBoardCreate`, `TaskBoardUpdate`, `TaskBoardList`), teams
(`TeamCreate`, `TeamJoin`, `TeamLeave`, `TeamList`), and session records
(`ArtifactRecord`, `SourceRecord`).

Not here: the tool contract and registry (`packages/engine/src/tool` and
`agent/toolRegistry/`), permission policy, profile allowlists, MCP transports,
or UI. Tools are implementations; the engine owns admission and execution.

## Entry points and ownership

- `src/index.ts` is the single barrel and activation point. It exports tool
  contracts and side-effect-imports every tool module so
  `registerAgentToolService` runs.
- `src/os/<tool>/` owns shell, read, write, glob, grep, and search tools.
- `src/edit/`, `src/fetch-url/`, `src/web-search/`,
  `src/ask-user-question/`, `src/select-tools/`, and `src/restore-file/` own
  their named tools.
- `src/features/<feature>/tools/` owns feature-specific tools such as plan,
  goal, cron, swarm, todo, notify, and skill. The feature service itself stays
  in `packages/engine/src/features/`.
- `src/code-intelligence/lsp/` owns the deterministic LSP fallback. It never
  spawns a language server; symbols, references, diagnostics, and hover are
  computed from file text and bounded.
- `src/git-worktree/` owns worktree list/create/remove. It uses the host process
  seam with argument arrays, never a shell, never `--force`, and rejects
  creation outside the repository. Every git child goes through the engine
  child-sandbox seam (`OMNICODE_SANDBOX_MODE`); `required` with no backend
  fails the git run, `auto` without a backend runs direct and appends the
  `[sandbox]` reason to the tool output.
- `src/notebook/` owns `.ipynb` parsing and cell edits with JSON schema
  validation and atomic writes.
- `src/tasks/` owns the session task board store and tools. `TaskBoardList` is
  distinct from the engine background-task `TaskList`; do not merge them.
- `src/teams/` owns team lifecycle tools backed by the engine session-scoped `ITeamService`; they share state with the engine `Team` tool. The task-board team records remain a store compatibility layer, not the tool backend.
- `src/records/` owns bounded artifact/source recording under `sessionDir`;
  user paths are never used as record output paths.
- `src/diagnostics/` owns pure tool-result retention, truncation, and
  context-budget diagnostics.
- Each tool normally has a pure contract/schema file (`<tool>.ts`), a tool class
  (`<tool>Tool.ts`), and a prompt template (`<tool>.md`) imported as raw text.

## Registration and visibility rules

- A tool class is registered with:

```ts
registerAgentToolService(ITool, ToolClass, { name: TOOL_NAME, domain: '...' });
```

  from `@hilbras/omnicode-engine/agent/toolRegistry/toolContribution`.
- Registration alone does not make the tool visible. The active profile allowlist
  in `packages/engine/src/session/agentLifecycle/profile/profiles.ts` must list
  the tool name. Add it there when adding a built-in tool.
- Approval is separate. Add only genuinely read-only/safe tools to
  `packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`;
  mutating tools need an explicit safety argument.
- `src/index.ts` must import the tool module for its side effect. A new file that
  nobody imports is dead code.
- Tool names are part of the model contract. Keep them stable unless the change
  is intentionally breaking.

## Import boundaries

- Tools sit above the engine. Import engine contracts through public subpaths
  such as `@hilbras/omnicode-engine/tool/toolContract` and
  `@hilbras/omnicode-engine/agent/toolRegistry/toolContribution`; import base
  utilities from `@hilbras/omnicode-base`.
- Tools must not import `human/` implementation, `llm-adapter/` internals,
  `packages/Addons`, `packages/memory`, or an app package.
- The engine must never import `packages/Tools` from `src/` or `test/`. Tests
  that drive the built-in tools live in `packages/features-integration`, whose
  setup imports this package; that keeps the engine manifest free of a build
  edge to Tools.
- Do not add a new package-level dependency without checking the workspace
  graph and `pnpm check:architecture`.

## Generated manifests

`packages/Tools` owns no generated manifest. `src/os/read/configSection.ts`
registers the `read` config section through the engine; the engine config
manifest generator scans engine `src` ownership, so that section does not get a
manifest row. Changes to a config schema still require the engine owner to run
`pnpm --filter @hilbras/omnicode-engine gen:config-manifest` when the schema is
wired into an engine-owned section. There are no wire/state manifests here.

## Tests

`packages/Tools/test/extract.test.ts` covers document format detection and RTF
extraction. The expansion tools have per-area tests under `test/tasks/`,
`test/teams/`, `test/code-intelligence/`, `test/git-worktree/`,
`test/notebook/`, `test/records/`, `test/os/bash/`, and `test/diagnostics/`.
The tools themselves are tested one layer down, from the cross-package suite:
`packages/features-integration/test/os/backends/node-local/tools/` holds
`read.test.ts` (82 cases), `grep.test.ts` (100), `bash.test.ts` (73),
`glob.test.ts` (60) and `write.test.ts` (22),
`packages/features-integration/test/app/edit/tools/edit.test.ts` covers `Edit`,
and `packages/features-integration/test/app/web/tools/fetch-url.test.ts` covers
`FetchURL`. `WebSearch` was the one tool with no tool-behaviour test of its own; it now has
`test/web-search/webSearchTool.test.ts` (result formatting, the empty-result and
provider-removed messages, and the five failure classifications in
`classifySearchError`). So the *package* grew no per-tool tests for a long time
while the *engine* had them; check there before concluding a tool is untested.
The package Vitest config no longer sets
`passWithNoTests`: an unmatched `include` fails the run instead of passing it.

`test/os/glob/globTool.test.ts` and `test/os/grep/grepTool.test.ts` are the pattern
for testing a tool that talks to a host seam: `makeTestRuntime` from
`test/helpers/testRuntime.ts` supplies the runtime, workspace, session and scope
contexts, `createFakeProcessService` serves both the ripgrep availability probe
and the real run from one handler (the probe only reads the exit code), and the
tool is constructed with those stubs. That harness makes the user-visible
contract testable without a real filesystem or `rg`:

- `Glob`: missing and non-directory roots, matches listed relative to the
  workspace, the `No matches found` and pagination notices, a failed ripgrep
  run, and the sensitive-file filter (`.env` dropped, `.env.example` kept, with
  `(N sensitive file(s) filtered)` when nothing survives).
- `Grep`: the three `output_mode`s (`content` records as `path:line:text`,
  `files_with_matches`, `count_matches` with its `Found N total occurrences…`
  summary), no-match wording, a failed ripgrep run, sensitive-file filtering, and
  the truncation notice. Note `Grep` sets `isError: false` on success where
  `Glob` leaves it undefined.

Both tools use `rg --null` output, so a record is `path\0payload\n`; a
`files_with_matches` record has an empty payload. `Grep` also stats each
reported file to sort by mtime, so give the fake filesystem a `stat`.

- `Read`: numbered lines rendered as `1\tone` with `Read` leaving `isError`
  **undefined** on success (a third convention — `Glob` undefined, `Grep` false),
  a `line_offset` + `n_lines` window, a negative `line_offset` tail read, and a
  missing file reported with its path. `Read` needs nine services plus an
  optional media store; only four do anything on a plain text read
  (`resultTruncation.isWireJournalPath`, `profile.getModelCapabilities`,
  `toolRegistry.resolve`, `toolPolicy.isToolActive`, `flags.enabled` — the last
  three only in the media branch), so the rest are one-line stubs. Its file reads
  go through the file source abstraction, which wants `readBytes`, `readLines`
  and `stat` on the fake filesystem.
- Note for tail reads: a file that ends with a newline has a final empty line, so
  `line_offset: -2` on `"one\ntwo\nthree\nfour\n"` returns `four` plus that empty
  line. Write tail assertions against a file without the trailing newline, or the
  expectation is wrong rather than the tool.

```bash
pnpm --filter @hilbras/omnicode-tools typecheck
pnpm --filter @hilbras/omnicode-tools test
pnpm --filter @hilbras/omnicode-tools exec vitest run test/notebook/notebook.test.ts
```

When adding a test, mirror `src/` under `test/` and drive the real tool class
through `resolveExecution`, not only the schema. `test/helpers/testRuntime.ts`
provides a fake agent runtime, host workspace/session contexts, and a fake git
process for worktree tool tests.

## Local traps and where new logic belongs

- Add the tool implementation, prompt, and schema here; add the profile
  allowlist and approval policy in the engine.
- Use `ToolAccesses` and `approvalRule`/`matchesRule` so approval and path rules
  stay meaningful.
- Path-taking tools must resolve through `resolvePathAccessPath` and the runtime
  workspace view; do not join raw input paths.
- Shell execution uses argument arrays and the host process/runtime seam, never
  shell strings.
- Respect result truncation and redaction contracts from
  `packages/engine/src/tool/toolContract.ts`; do not bypass them.
- A feature tool belongs in `src/features/<feature>/tools/`; its service and
  state belong in `packages/engine/src/features/<feature>/`.

## Do not add here

Do not add engine services, permission policy, profile definitions, MCP
transports, agent loop logic, UI code, or tests that only read source text.


## Bash sandbox

`src/os/bash/sandbox.ts` selects a Kaos sandbox backend for Bash. `OMNICODE_SANDBOX_MODE=off|auto|required` controls it; default is `off`. `auto` falls back to direct execution with an explicit reason, while `required` fails closed with `sandboxRequiredDenialMessage(reason)` — a message that states the command will not run, that retrying cannot help because the sandbox is prepared before the command starts, and what the user can change. `OMNICODE_SANDBOX_NETWORK=shared` keeps the network namespace shared; default is denied. `OMNICODE_SANDBOX_BACKEND` pins one backend (bwrap, seatbelt, windows, landlock); an unavailable pinned backend is never substituted — in `auto` the command runs direct and `BashTool` prefixes the refusal reason to the output, in `required` the command is denied. Permission mode still gates execution first.

`OMNICODE_SANDBOX_DENY_READ` (comma-separated absolute paths/globs) flows into the sandbox policy. bwrap cannot express read denial, so a deny-read policy on bwrap fails the plan with an explicit reason (direct in `auto`, denied in `required`); the seatbelt backend projects the rules. Write-root and deny-read values are passed to the plan builder unfiltered: a non-absolute entry fails plan validation, so a misconfigured variable falls back with the entry named instead of silently shrinking the grants.

A `BashSandboxRequest` may carry `allowedHosts` — the exec-policy host amendment attached to an approved command. No backend can confine a process's network to specific hosts yet, so `prepare` refuses such a request (`kind: 'denied'` with `hostRestrictionDenialMessage`), and `BashTool` refuses on its own when the sandbox seam is absent. Never let a host-restricted command run with unrestricted network; when host-level enforcement exists, thread the amendment into the backend policy instead of removing the refusal.

## Per-path grants for in-process tools

`src/os/sandbox/pathGrants.ts` applies the same grants to in-process tools: `OMNICODE_SANDBOX_WRITE_ROOTS` restricts Write/Edit/ApplyPatch/NotebookEdit/RestoreFile to the allowlisted subtrees, and `OMNICODE_SANDBOX_DENY_READ` refuses Read/Lsp (and notebook reads) on matched paths. Configure nothing and the checks pass. Parsing is fail-closed in both directions: a non-absolute entry is a refusal naming the rejected entries (never a silent shrink of the grant set), and an invalid allowlist denies the operation until the host fixes the variable. For the child-process path the raw entries reach the plan builder, whose validation fails the plan with the entry named. Grep/Glob tree walks do not apply deny-read yet; session-record writers (`records/`) never take model paths and stay outside the grant check.

## Multi-file patch

`src/patch/applyPatch.ts` parses Codex-style multi-file patches and applies add/update/delete operations with exact hunk matching and rollback on failure. `src/patch/patchJournal.ts` records each file's pre-write content under `<root>/.omnicode/patch-journal/` before the first mutation and removes it on success, so `recoverPatchJournals(root)` can restore a tree left half-written by a crash. `applyPatch` verifies the whole patch against the pre-patch tree before writing anything (every touched path, move destinations included), rejects patches that target the same path twice, supports `*** Move to:` on an update, and throws `PatchApplyError { code, committedFiles }` so the tool can report the committed delta. Use `patchOperationPaths(operation)` for every path an operation touches — it is the single source for resolution, approval rules, and backups. The `ApplyPatch` tool registers this engine with runtime FS, dry-run, profile admission, and path accesses, and runs non-dry-run patches under the engine workspace write lock, healing any journal a crashed run left behind. `Write` and `Edit` take the same lock around their writes.
