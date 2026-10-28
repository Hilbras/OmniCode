# Memory

Trust-gated persistent memory for coding sessions: capture with provenance,
deterministic trust promotion, lexical retrieval with honest budgets, and
resumable task state.

Consumed from source through the workspace exports map — there is no `build`
step and no `dist`, matching `Kernel/Addons` and `Kernel/Tools`.

## Layout

| Path | Role |
|---|---|
| `src/contracts/` | public types: records, trust, scopes, retrieval statuses, `IMemoryService` |
| `src/trust/trustPolicy.ts` | pure trust + tier-admission rules; no I/O, no clock, no model |
| `src/security/` | secret redaction (wraps core) and instruction-like-content detection |
| `src/storage/` | the `MemoryStorePort` seam, an in-memory store, and the minidb store |
| `src/retrieval/` | normalize → scope → lexical → gates → rank → budget → explanation |
| `src/service/` | the `IMemoryService` implementation, record factory, runtime wiring, maintenance scheduler, evidence watcher |
| `src/context/` | agent-scope project identity and the reminder providers |
| `src/tool/` | the `memory_search`, `memory_save` and `memory_forget` agent tools |
| `src/control/` | the user-facing read/confirm/forget/export surface, shared by the REST routes and the CLI |
| `src/capture/` | compaction-summary parsing and the agent-scoped capture that stores it as task state |
| `src/feature/` | the `Feature`, the `[memory]` config section, the experimental flag |

## Data model

A record carries `id`, `tier`, `category`, `content`, `trust`, `trustReason`,
`sourceType`, `origin`, `scope`, `createdAt`/`updatedAt`, `lifecycle`,
`evidence[]`, `derivedFrom[]`, `supersedes`/`supersededBy`, `expiresAt`,
`revision`, `accessCount`/`lastAccessedAt`, `fingerprint`, `repoRevision`,
`verification`, `approval`, `conflictsWith[]`, `suspicious`,
`suspicionReasons[]`, and `redactionCount`. `MemoryRecordSchema` (zod) is the
single validator; `parseMemoryRecord` returns `undefined` for anything that does
not fit, and retrieval records an `integrity` rejection rather than failing.

### Trust levels

| Level | Meaning | How it is reached |
|---|---|---|
| `unverified` | a claim with no present, fingerprinted evidence | default for observations, tool output without evidence, and every model-authored memory |
| `trusted` | the user stated it | `user_statement` / `user_correction` |
| `verified` | present, fingerprinted evidence backs it | the verification policy in `verificationFromEvidence` |
| `system` | the host application owns it | requires a `MemoryAuthority` issued by `issueMemoryAuthority` |

`evaluateInitialTrust` and `evaluatePromotion` are pure. The rules that matter:

1. A model-authored memory can never exceed `unverified` on its own. Repetition,
   rewrites, and restatements are all `derived` or `model_inference` and stay at
   `unverified` (`test/trust.test.ts`).
2. A model cannot attribute a statement to the user. `origin: 'model'` with a
   `user_*` source type is forced to `unverified`.
3. `unverified → verified` requires present, fingerprinted evidence.
   `→ trusted` requires a confirmation that arrives from outside the
   conversation (`origin !== 'model'`). `→ system` requires an authority.
4. `accessCount` is never consulted by the trust policy. A test pins that 50
   retrievals change nothing about a promotion decision.
5. `update()` never changes trust. Editing a record cannot launder evidence into
   a promotion; that is `promote()`'s job.

### Canonical approval

`capture()` rejects `tier: 'canonical'` outright. Canonical status is only
reachable through `approveCanonical()`, an explicit application action, which
enforces:

- `canonical.policy` requires a `MemoryAuthority`.
- `canonical.instruction` requires `origin !== 'model'`, at least `trusted`
  content, and an explicit approval.
- `canonical.fact` / `canonical.preference` require at least `trusted` content or
  an approval.
- `task` and `observation` are not canonical categories.

`checkTierAdmission` is also applied to `working` and `distilled` writes, which
is how "a security policy cannot live in working memory" is enforced.

## Conflicts

`subject` is a conflict key (`devserver.port`). A caller may supply it; when it
is missing, `capture` derives one for a short `fact`/`preference` statement
shaped like "<key> is/uses/requires/defaults to <value>" (`src/service/subjectInference.ts`).
The inferred key must name at least two words or a dotted name, so "the devserver
port is 5173" keys as `devserver.port` while "the cli is bundled with tsup" gets
no key at all: a one-word key would retire an unrelated statement about the same
noun. When a new record lands on a subject that already has an active record:

- it supersedes the sibling when it has strictly higher trust, or when it is a
  `user_correction` and the sibling is not;
- otherwise both stay active and each records `conflictsWith`, which surfaces in
  retrieval explanations and in the tool output.

Recency never decides a conflict on its own. Identical content in the same scope
and tier is deduplicated by fingerprint instead.

## Storage

`MemoryStorePort` is the seam; the service never talks to minidb directly.
`InMemoryMemoryStore` backs the deterministic tests, `MiniDbMemoryStore` backs
production.

Keys, all in one database under `<homeDir>/memory`:

```
m:<id>                     the record
f:<fingerprint>            -> { id }     deduplication / idempotency
s:<scopeKey>:<id>          -> { id }     scope index
k:<scopeKey>:<subject>:<id>-> { id }     conflict index
q:<jobId>                  review job
x:<requestKey>             -> { id }     capture idempotency
__schema                   { version }
```

Because a scope key contains `:`, index readers read the `id` from the pointer
*value* rather than slicing the key. Reads, record writes, pointer writes and
pointer deletions for one capture go through a single `commit()` call, so a
capture is atomic; supersession writes the successor, the demoted sibling and
the pointer updates in one batch.

`MiniDbMemoryStore` uses `valueCodec: 'json'`, `valueMode: 'disk'` and a text
index over `content`. Schema versioning is owned here (minidb has none): a store
written by a newer version fails with `memory.schema_too_new` rather than being
rebuilt.

Expiry is an explicit lifecycle transition (`active → expired`), not minidb's
native TTL — minidb's reaper deletes, and the two must not be confused.
`purgeWorking()` is the separate physical delete, after a grace window.

`delete()` is a hard delete: the record and every index entry go, and the only
trace is a log line. No tombstone is retained, because historical traceability
is not a reason to keep content the user asked to remove.

## Retrieval

```
search(query)
  ├─ normalizeQuery        NFKC, control chars, 512-char cap, stopword filter
  ├─ scope filtering      exact scope keys derived from the request ids
  ├─ lexical              searchBounded over the allowed keys only
  ├─ gates                scope · tier · lifecycle · expiry · trust · category · suspicion · relevance
  ├─ ranking              lexical + trust + scope + bounded reinforcement
  ├─ budget               maxResults · maxContextChars · maxMemoryChars · maxCandidates · maxPostingsVisits
  ├─ explanation          per-hit components, gate decisions, evidence
  └─ status               complete · partial · no_match · unavailable · failed
```

Other repositories' records are excluded twice: they are not in any requested
scope prefix, and the store's `allowedKeys` filter drops them inside the search
adapter before any caller sees them.

`status: 'partial'` always carries `budget.constraints`, the constraint that
bound the result, and `RETRIEVAL_NOTICE_INCOMPLETE`. The retriever never claims
exhaustiveness when a budget or an index-building state cut the search short;
while the text index is building it falls back to a scope scan and stays
partial.

Reinforcement is capped at `0.3` and weighted `0.1` against a lexical weight of
`1.0`, so a heavily retrieved memory cannot outrank a directly relevant one.

### Morphology and query groups

`src/retrieval/stem.ts` builds both sides of the match from four additive
mechanisms, so a token always matches itself even when a transform is wrong:

1. Identifier splitting before tokenization: `MemoryService` → `memory service`,
   `parse_http_response` already splits on the separator.
2. A conservative English suffix stripper (`linting`/`linter` → `lint`), with
   `ies` → `y` so `repositories` and `repository` meet, and `es` stripped only
   after a sibilant so `writes` → `write` rather than `writ`.
3. A small synonym table (`src/retrieval/synonyms.ts`) for coding shorthand —
   `repo`/`repository`, `db`/`database`, `docs`/`documentation`. Every entry
   expands the index and the query alike, so the two sides stay symmetric.
4. `searchText`: each record's derived token set. The text index covers
   `['searchText', 'content']`, so records written before the field existed
   still match on raw content with no migration.

A query is also grouped by `stem` (canonicalized through the synonym table), and
the relevance gate counts coverage per group: `linter linting` is one word, not
two. A query of one or two groups needs one match; three or more need two, so a
record that shares one incidental word with a long question is rejected with a
`relevance` gate decision instead of ranked last. No embeddings, no vector
store.

### Evidence freshness

`refreshEvidence()` re-reads the files a memory cites, compares content
fingerprints (`sha256:`-prefixed, produced by `fingerprintText`), and delegates
to `markStale()`. Evidence whose fingerprint did not come from that scheme is
skipped, and a file that cannot be read counts as *unknown* rather than changed —
an unreadable file never demotes anything. Demotion sets trust to `unverified`,
which is what removes the record from injection and from search.

Two mechanisms feed it:

- `EvidenceWatcher` (`src/service/evidenceWatcher.ts`) watches the directories
  that hold cited files through an injectable `EvidenceWatchPort`; the production
  port is `node:fs.watch` with `persistent: false`. A change debounces 300 ms and
  then runs a bounded refresh, so an edited file demotes its memory within a
  second. The watch set is reconciled against `citedFileRefs()` on a 60-second
  tick and immediately after a capture that stored file evidence; at most 64
  directories are watched, one handle each, and `dispose()` closes every handle
  and timer. The feature flag is checked before each reconciliation, so turning
  memory off drops all watches.
- The scheduler's 15-minute sweep stays as the fallback: a watcher sees nothing
  that happened while the process was not running.

The watcher is deliberately not a git integration. A blob hash is the same
content hash the fingerprint already is, and it would add a git dependency plus a
separate path for repositories without one, while the exit criterion is only
"stale within seconds" — which content fingerprints already reach. `repoRevision`
is still recorded on capture for provenance.

`/memory list` appends `(stale)` and `/memory show` adds a line when any
evidence item carries `state: 'changed'`.

### Measured ranking quality

`test/evaluation.test.ts` scores the labelled corpus in
`src/retrieval/evaluation.ts` (15 memories, 15 queries) with `recall@k`,
`precision@k` and reciprocal rank. Current measurement at k=5:

| Metric | Before phase 4 | Measured now | Floor asserted |
|---|---|---|---|
| recall@5 | 1.000 | 1.000 | 1.0 |
| precision@5 | 0.783 | 1.000 | 0.9 |
| MRR | 0.950 | 1.000 | 0.95 |

The gains come from the relevance gate, not from better ranking: with coverage
enforced, a query returns the memory it is about and drops the partial matches
that used to fill the remaining slots. The corpus covers facts, a preference,
numbers and a negated question, and the same file also runs three real-world
scenarios end to end: a contradicted fact that retires its predecessor, a fact
whose cited file changed that leaves search, and two projects storing the same
fact without either answering for the other.

The floors are regression guards, not aspirations; the numbers are measured on
every run. The evaluation also refuses to score a case with no relevant memory
rather than reporting a perfect 1.0.

### Measured injection cost

Automatic injection runs under `AUTO_INJECT_RETRIEVAL_BUDGET` (5 results, 1500
context characters, 300 per memory). Measured over the labelled queries against
the whole corpus: 278 characters of injected context on average, 292 at the
maximum, and 0.3–1.1 ms per query once warm (about 16 ms for the first pass,
which pays for opening the store and building the index). `evaluation.test.ts`
asserts the maximum stays inside the budget, the average stays at or below 400
characters, and a query stays under 250 ms — ceilings loose enough that a slow
CI machine does not fail the build, tight enough that an unbounded injection
does.

`test/scale.test.ts` repeats the labelled queries against a 400-memory corpus
(390 generated distractors plus the labelled set) and checks that recall holds,
that the work stays bounded, and that a second repository stays invisible. The
candidate budget is enforced **globally** across scope prefixes, not per prefix,
so a query cannot examine five times its intended work by matching five scopes.

## Security boundaries

The primary boundary is the code path, not a keyword filter:

- `capture()` cannot mint canonical memory, and `origin: 'model'` is capped at
  `unverified`.
- `system` trust requires an authority that only host code can obtain.
- Retrieved memory is injected as a `<system-reminder>` through the existing
  `IAgentReminderService`, alongside the other reminders. There is no second
  system-message mechanism, and the injected text states that memory is data.
- `redactMemoryContent` runs before persistence: it delegates to core's
  `redactSecretString` and adds PEM/AWS/SSH private-key blocks. The original is
  never stored, `redactionCount` records that a change happened, and the
  redaction itself changes the fingerprint so a redacted duplicate is detected.
- `analyzeMemoryContent` flags instruction-shaped content. Suspicious content is
  excluded from retrieval **unless** it is a canonical record carrying an
  explicit approval — an explicit human decision outranks a keyword heuristic,
  and the flag stays visible in the explanation and in the tool output.

Suspicion detection is defence in depth. It is a list of regular expressions in
`src/security/suspicion.ts`, not a parser, and it will both miss and over-match;
the trust and approval gates do not depend on it.

## User control surface

`src/control/memoryControl.ts` is the one implementation behind both the
`/memory` CLI command and the server's `/api/v1/memory` routes. Every entry
point resolves a `MemoryViewer` (workspace, project, session) and filters
through `isScopeVisible`, so another project's or session's record is
`not_found` rather than readable — the same rule `memory_forget` uses.

- `list` / `get` return a `MemoryView`: the record minus derived fields, with
  evidence reduced to `{kind, ref, state, observedAt}`.
- `confirm` is the user-authority promotion: `unverified → trusted` with
  `origin: 'user'`. It is idempotent (`unchanged` once already trusted) and
  refuses a record that is not active. No tool can reach this path.
- `forget` invalidates and keeps the reason as evidence; nothing is
  hard-deleted.
- `export` wraps every visible record in a versioned envelope
  (`omnicode.memory.export`, version 1).

With the flag off the control functions report `enabled: false` / `disabled`
instead of reading the store, and the CLI command is hidden.

## Capture at compaction

`AgentMemoryCompactionCapture` subscribes to the agent-scoped `IEventBus` for
`CompactionCompleted` — the one seam that carries the summary without core
importing this package. The agent view only delivers that agent's events, so a
subagent's compaction cannot overwrite the main agent's task state.

`parseCompactionSummary` reads the headings the compaction instruction fixes
(`Objective`, `Decisions`, `Work State` → `Completed`/`Active`/`Blocked`,
`Next Move`, `Relevant Files`); prose outside them is ignored, `(none)` is
dropped, and a summary that follows no template yields `undefined` so nothing is
written rather than an empty task state. The result goes through
`saveTaskState`, which upserts on `task_state:<sessionId>` in the session
scope: a second compaction replaces the first record instead of appending, and
the existing `memory_task_restore` provider injects it on the next session.

The record is `category: 'task'`, `origin: 'application'`, and stays
`unverified` — the trust policy gives an application-origin write no promotion.
Evidence is the session itself (`observation`, `session:<id>`); the compaction
event does not expose a turn id, so no turn range is recorded. With the flag off
the handler returns before touching the store.

## Background processing

`runReview()` is driven by `MemoryMaintenanceScheduler`, owned by the
app-scope service. It drains on a debounce after any capture is queued, once at
startup (which is what recovers jobs left behind by a crash — they are durable),
and on a low-frequency poll that only acts when a job is actually pending. An
hourly sweep expires due records. Drains never overlap, failures are logged and
left for the next pass, and every timer is cleared on dispose.

The same sweep expires due records and then purges expired working memory, but
only after `workingGraceMs` — expiry is a visible lifecycle transition, the
physical delete is a separate later step.

The queue is therefore not best-effort: a job that survives a crash still runs
on the next start. What is *not* guaranteed is that a review completes before
the process exits.

The scheduler and the service share one clock, supplied by `MemoryRuntime`, so
retention decisions cannot disagree with the timestamps writes were stamped
with.

## Wiring

`src/index.ts` registers the config section, the flag and the `MemoryFeature` at
import time; `Kernel/API/src/index.ts` re-exports this package, so importing the
Kernel surface is the activation point. Nothing downstream needs a side-effect
import, and `omnicode-core` deliberately does **not** import this package —
not even in `test/setup.ts`. Core's DI tests assert that no scope topology has
been declared at import time, and any import that reaches `app/scopes` breaks
them. Nothing in core depends on memory, so there is nothing to activate there.

- Flag: `OMNICODE_EXPERIMENTAL_MEMORY`, id `memory`, **default off**. With the
  flag off, capture is rejected, retrieval reports `unavailable`, and the store
  is never opened.
- Config `[memory]`: `enabled`, `dir`, `maxContentChars`, `workingTtlMs`,
  `workingGraceMs`, `injectCanonical`, `reviewMaxAttempts`, `reviewBackoffMs`,
  `maxQueuedReviews`. Env: `OMNICODE_MEMORY_ENABLED`, `OMNICODE_MEMORY_DIR`,
  `OMNICODE_MEMORY_MAX_CONTENT_CHARS`, `OMNICODE_MEMORY_WORKING_TTL_MS`,
  `OMNICODE_MEMORY_INJECT_CANONICAL`.
- Agent tool `memory_search`: read-only, its own approval rule, returns the
  status, provenance, flags and the truncation notice. It is gated by the flag's
  `when` predicate, so with the feature off the model is never offered it.
- Agent tools `memory_save` and `memory_forget`, gated the same way and each with
  its own approval rule. `memory_save` captures a `working` memory as
  `origin: 'model'` / `agent_observation` in the repository (default), session
  or global scope, keyed for idempotency on `<sessionId>:<toolCallId>`; the trust
  policy keeps it `unverified`, so the tool cannot mint trusted memory.
  `memory_forget` only invalidates (never deletes) a record whose scope is
  visible to the current session (`isScopeVisible`).
- Reminder variants `memory_canonical` (canonical tier only, minimum trust
  `trusted`, auto-inject budget) and `memory_task_restore` (once per session).

## Adding a package under Kernel/

Four edits, each of which fails silently when missed: `pnpm-workspace.yaml`
(globs `Kernel/*`, already covered), `flake.nix` (`workspacePaths` **and**
`workspaceNames`, both manual), the root `vitest.config.ts` project glob, and
the `--filter './Kernel/*'` arguments in `build:packages` / `typecheck`. The
memory package has all four.

## Tests

| File | Covers |
|---|---|
| `trust.test.ts` | the promotion rules and tier admission, plus the same through `capture`; conflict resolution and subject inference |
| `storage.test.ts` | record integrity, corrupt records, failed writes, and the minidb backend on a real temp dir |
| `retrieval.test.ts` | recall, scopes, gates, ranking, budgets and every retrieval status; synonym expansion, identifier splitting, query grouping and the relevance gate |
| `lifecycle.test.ts` | expiry vs invalidation vs supersession vs deletion, canonical approval |
| `security.test.ts` | injection, cross-project isolation, redaction, authority forgery, unapproved promotion |
| `capture.test.ts` | idempotency, the review queue, retry/backoff, failure reporting |
| `continuity.test.ts` | task state save/restore, stale evidence, tool-output honesty, compaction-summary parsing and the upsert that replaces prior task state |
| `injection.test.ts` | what actually reaches the model through the reminder providers |
| `maintenance.test.ts` | the scheduler: startup drain, debounce, poll, retention, overlap |
| `integration.test.ts` | the real DI graph: feature assembly, flag on/off, a real store on disk, queued work draining unattended |
| `Kernel/core/test/memory/agentMemory.test.ts` | a real agent turn: the model calls `memory_search` through the actual engine loop and sees the result |
| `tool.test.ts` | the `memory_search` contract, schema, approval rule and access counting; `memory_save` trust ceiling, idempotency and scopes; `memory_forget` visibility and invalidation; the user control surface (list, show, confirm, forget, export, cross-scope refusal) |
| `concurrency.test.ts` | two openers on one store: the second reads, its writes fail loudly, the lock comes back |
| `process.test.ts` | a real second OS process holding the lock, via `test/fixtures/hold-store.mts` |
| `scale.test.ts` | 400 memories, on both the in-memory store and real minidb, including a reopen |
| `evaluation.test.ts` | measured ranking quality and injection cost against the labelled corpus, morphological recall, the no-match guarantee, and the real-world cases: contradictions, stale citations, cross-project isolation |
| `evidence.test.ts` | evidence freshness: changed, unchanged, unreadable, foreign, budgeted; the watcher's debounce, bound, cleanup and real `fs.watch` port |

## Known limitations

- LLM-based distillation is deliberately absent. The review queue's processing
  is deterministic (dedupe, conflict resolution, policy gates); it never asks a
  model to summarise. Adding a model later means re-running the same trust
  gates, not bypassing them.
- A review that is queued and then killed with the process stays queued. The
  scheduler drains on the next start, so nothing is lost, but nothing guarantees
  completion before exit.
- Conflict detection needs a `subject`. One is inferred only for a short
  `fact`/`preference` statement with a compound key; every other contradiction
  is stored side by side and only surfaced if the caller supplied a key.
- Evidence freshness covers the directories that hold cited files, capped at 64
  of them, plus a 15-minute sweep. A file outside those references is never
  checked, and a change made while no process is running is noticed by the next
  sweep rather than immediately. `resetAccessCount()` is exposed for operators
  rather than wired to a schedule.
- The store is single-writer (minidb holds an exclusive lock). A second Omnicode
  instance opens the memory store read-only: reads still work, writes fail with
  `memory.storage_write_failed` and `capture` returns `failed`, and
  `diagnostics().readOnly` reports why. Proven both in-process
  (`concurrency.test.ts`) and across two real operating-system processes
  (`process.test.ts`).
- `list()` and `listAll()` read pointer values, so a scope-filtered list cannot
  include a tier whose identifying id the caller did not pass.
- Secret redaction is pattern-based. It is not a DLP product; assume it misses
  things it was never shown.