# End-to-end test plan

Status: active  
Scope: cross-surface behavior for the seven workstreams in `docs/plans/qwen-parity-improvement-plan.md`. This plan covers permission auto mode, memory dream consolidation, channels, tooling, teams/arena/budgets, and sandboxing.  
Source of truth: this English document. The Chinese mirror is `docs/zh/quality/e2e-test-plan.md`. Reconcile divergences against this file.

Related documents:

- [Architecture and workstream status](../architecture/omnicode-architecture.md)
- [Memory recall evaluation baseline](memory-recall-evaluation.md)

## How to run

There is no single end-to-end suite that covers every workstream. Use the narrowest layer that can observe the behavior:

```bash
pnpm check:guards
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy
pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts test/dreamConsolidation.test.ts test/relevanceSelector.test.ts
```

CLI end-to-end tests are gated and are not part of the default run:

```bash
OMNICODE_E2E=1 pnpm --filter @omnicode/cli exec vitest run test/e2e
OMNICODE_E2E_REAL=1 pnpm --filter @omnicode/cli exec vitest run test/e2e/real-llm-smoke.e2e.test.ts
```

Provider tests use recorded HTTP cassettes. Recording is opt-in with `OMNICODE_CASSETTE_RECORD=1` and must not be enabled in CI.

Do not use sleeps or timeouts to synchronize a case. Wait for an explicit signal: a rendered state, an approval prompt, a durable event, or a process exit.

## Status summary

| Area | Test layer available | Cases in this plan |
|---|---|---|
| Permission auto mode | Automated policy tests; manual CLI checks | Ready |
| Memory dream consolidation | Automated memory tests; manual `memory_manage` check | Ready |
| Channels | `packages/channels/test/` | Targeted tests pass; automated E2E deferred |
| Tooling | `packages/Tools/test/` | Targeted tests pass; automated E2E deferred |
| Teams, arena, budgets | `packages/engine/test/agent/team/` | Targeted tests pass; automated E2E deferred |
| OS sandboxing | `packages/Kaos/test/sandbox/` | Targeted tests pass; automated E2E deferred |

Cases without a passing targeted package test must not be reported as passing. Mark them in progress or blocked, and cite the failing package check.

## 1. Permission auto mode

### Automated coverage

`packages/engine/test/agent/permissionPolicy/permissionPolicyService.test.ts` covers the policy chain. `denialTracking.test.ts` covers escalation state.

```bash
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy
```

### Cases

| Case | Steps | Expected |
|---|---|---|
| Safe read-only tool is approved | Put the policy in `auto` mode and request a read-only tool such as `memory_search` or a file read | Approved without a prompt; the approval names the classifier category, not a raw command |
| Mutating tool asks | Request a write or edit inside the workspace | Approval prompt; the classifier does not silently approve |
| Dangerous command asks | Request a destructive shell command such as a recursive remove | Dangerous-command policy runs ahead of the classifier and asks |
| Repeated denial escalates | Deny the same request three times in `auto` mode | Denial tracking surfaces escalation instead of repeating the identical prompt forever |
| Mode change resets denial state | Trigger a denial, switch to `manual`, then back to `auto` | Denial counters reset with the policy instance/mode change |
| Trusted user answer is honored | Answer an approval question with a trusted response | The classifier approves the corresponding action without a second prompt |
| MCP tool ambiguity asks | Request an MCP tool whose grant is ambiguous or private/link-local | Request is rejected or escalated according to policy, never auto-approved |
| Telemetry is redacted | Exercise the cases above with telemetry enabled | Events contain only safe categories; no raw command text, paths, environment values, tokens, or error bodies |

### Manual CLI pass

1. Start the CLI with a disposable `OMNICODE_HOME`.
2. Switch to `auto` mode.
3. Trigger a read-only operation, a workspace write, and a destructive shell command.
4. Deny one prompt repeatedly and confirm escalation is visible.
5. Inspect telemetry output and confirm no raw commands or secrets leaked.

## 2. Memory dream consolidation

### Automated coverage

`packages/memory/test/dreamConsolidation.test.ts` exercises the service method; `tool.test.ts` and `memoryManageTool` coverage exercise the tool surface.

```bash
pnpm --filter @hilbras/omnicode-memory exec vitest run test/dreamConsolidation.test.ts test/tool.test.ts
```

### Cases

| Case | Steps | Expected |
|---|---|---|
| Merge related working memories | Capture at least two `working` memories with the same subject and scope, then call `dreamConsolidate(scope)` | One consolidated `distilled` record with `origin: application`, `sourceType: derived`, and evidence pointing at every source |
| Supersede sources | Inspect the merged sources after consolidation | Sources are superseded; search returns the consolidated record, not both |
| Skip legal hold | Place legal hold on one source, then consolidate | Held source is untouched and excluded from the merge; the operation reports what it skipped |
| No candidates | Consolidate an empty scope | Completed status with zero consolidated and zero superseded; no empty record is written |
| Scope isolation | Consolidate project A while project B holds the same subject | Only project A records change; project B is untouched |
| Secret boundary | Include a `secret` record in the scope | The secret never appears in consolidated content, evidence summaries, tool output, or provider-bound context |
| Tool parity | Call `memory_manage` with `dream` or `consolidate` | Output matches the service result and names the consolidated ids without exposing record bodies |

### Manual CLI pass

1. Capture two facts with the same subject in one project.
2. Run the memory management command with the dream action.
3. Search for the subject and confirm one distilled result.
4. Confirm a legal-held source was skipped and remains readable.

## 3. Channels

Status: implemented core. `packages/channels/` contains the contract, registry, session binding, lifecycle commands, Telegram, and webhook-based DingTalk, WeChat, Feishu, and Slack adapters. Automated coverage is `packages/channels/test/`. Discord and automated cross-process E2E remain deferred. Run the adapter suite with:

```bash
pnpm --filter @hilbras/omnicode-channels test
```

Planned cases:

| Case | Expected |
|---|---|
| One contract, multiple adapters | Telegram plus at least two of DingTalk, WeChat, Feishu, Slack, Discord operate through the same base contract |
| Inbound message binds a session | A channel conversation maps to a durable OmniCode session; restarting the adapter resumes the binding |
| Outbound delivery | Agent output is delivered once, with retry behavior that does not duplicate messages |
| Channel-scoped memory | Memory written from a channel is scoped to that channel and project; another channel cannot retrieve it |
| Trust and sensitivity | Untrusted channel memory is labeled and never auto-injected; `secret` memory never leaves the host |
| Adapter failure is explicit | Missing credentials, network failure, and malformed payloads surface actionable errors; no silent drop |
| Lifecycle commands | Channel start, stop, status, and logout work without leaving orphaned sessions |

Automation is expected as adapter tests plus one integration smoke test per adapter. The suite must not require live external credentials in CI.

## 4. Tooling

Status: implemented. `packages/Tools/src/` has `code-intelligence/lsp`, `git-worktree`, `notebook`, `tasks`, `teams`, `records` (artifact and source), and `diagnostics`, registered in `packages/Tools/src/index.ts`. Profiles and approval policies include the new tools. Run the tool tests with:

```bash
pnpm --filter @hilbras/omnicode-tools test
```

Planned cases:

| Case | Expected |
|---|---|
| Profile visibility | Every new tool is registered in `packages/Tools/src/index.ts` and admitted by the active profile; an unlisted tool is invisible to the model |
| LSP read-only behavior | Symbol lookup and diagnostics are read-only and approved by default only if genuinely safe |
| Worktree lifecycle | Create, list, and remove a git worktree; removal never discards tracked changes without an explicit confirmation path |
| Notebook editing | Cell reads and edits preserve notebook structure and reject malformed JSON |
| Task and team tools | Task creation, assignment, and completion are visible to the owning team only |
| Artifact and source recording | Recorded artifacts carry provenance and remain readable after the session restarts |
| Retention and truncation | Oversized tool results are truncated with a diagnostic; the model can see that truncation happened |
| Context budget | Diagnostics report the budget, usage, and the reason for any dropped content |

Each tool also needs a test that fails when the tool is removed from the profile allowlist.

## 5. Teams, arena, and workflow budgets

Status: implemented. `packages/engine/src/agent/team/` contains the team service, arena, workflow budget ledger, task notification queue, forked-agent cache, and registered `Team` tool, with tests under `packages/engine/test/agent/team/`. Run:

```bash
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/team
```

Planned cases:

| Case | Expected |
|---|---|
| Team lifecycle | Create, join, list, and disband a team; disbanding releases child agents and shared state |
| Shared task list | Two team members see the same task state and cannot overwrite each other silently |
| Arena comparison | The same task runs against multiple models; results are labeled by model and no winner is fabricated when scores tie |
| Workflow budget | A budget ledger stops further model calls at the limit and reports which step hit it |
| Background notifications | Completion events are queued and delivered once per consumer, including after a reconnect |
| Forked-agent cache | A cached fork reuses only compatible context; a changed base invalidates the entry |
| Subagent plan policy | A subagent cannot exceed the tool policy of its parent profile |

## 6. OS-level sandboxing

Status: implemented core. `packages/Kaos/src/sandbox/` contains bwrap execution, shell and path policy, backend selection, availability probing, and the file worker, with tests under `packages/Kaos/test/sandbox/`. The landlock backend reports that enforcement is unavailable in pure TypeScript and fails explicitly rather than pretending to isolate. Run:

```bash
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/sandbox
```

Planned cases:

| Case | Expected |
|---|---|
| Sandbox availability | The runtime reports whether bwrap or landlock is available, with a clear reason when it is not |
| Sandboxed command | A command runs inside the sandbox with the declared filesystem and network policy |
| Path policy | Writes outside the allowed root fail explicitly; symlink traversal does not escape the sandbox |
| Permission mode interaction | Sandbox selection does not bypass approval; `manual` still prompts, `auto` still classifies |
| Failure recovery | A sandbox launch failure is explicit and recoverable; the command is not silently retried unsandboxed |
| Diagnostics | Sandbox status is visible without exposing secrets or host paths outside the workspace |

## Reporting rules

- Attach the exact command and its result to every claimed pass.
- Report a blocked case as blocked and name the missing module.
- Do not convert a planned case into a pass based on code reading alone.
- Report a skipped or unmatched suite as not run, never as green.
