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
| `src/service/` | the `IMemoryService` implementation, record factory, runtime wiring, maintenance scheduler |
| `src/context/` | agent-scope project identity and the reminder providers |
| `src/tool/` | the `memory_search` agent tool |
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

`subject` is an optional caller-supplied conflict key (`devserver.port`). When a
new record lands on a subject that already has an active record:

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
  ├─ gates                scope · tier · lifecycle · expiry · trust · category · suspicion
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

### Morphology

`src/retrieval/stem.ts` applies a conservative English suffix stripper on both
sides of the match. Each record carries a derived `searchText` field holding the
token set plus its stems; the text index covers `['searchText', 'content']`, so
records written before this field existed still match on their raw content with
no migration. A query is stemmed the same way. This is justified by measurement,
not fashion: the evaluation corpus showed `linter` failing to retrieve
`linting`, which §10 makes the trigger for going beyond exact tokens. No
embeddings, no vector store.

### Evidence freshness

`refreshEvidence()` re-reads the files a memory cites, compares content
fingerprints (`sha256:`-prefixed, produced by `fingerprintText`), and delegates
to `markStale()`. Evidence whose fingerprint did not come from that scheme is
skipped, and a file that cannot be read counts as *unknown* rather than changed —
an unreadable file never demotes anything. The scheduler runs it on a 15-minute
cadence against the current project only, bounded per pass.

### Measured ranking quality

`test/evaluation.test.ts` scores the labelled corpus in
`src/retrieval/evaluation.ts` (10 memories, 9 queries) with `recall@k`,
`precision@k` and reciprocal rank. Current measurement at k=5:

| Metric | Measured | Floor asserted |
|---|---|---|
| recall@5 | 1.000 | 1.0 |
| precision@5 | 0.783 | 0.6 |
| MRR | 0.950 | 0.9 |

The floors are regression guards, not aspirations; the numbers are measured on
every run. The evaluation also refuses to score a case with no relevant memory
rather than reporting a perfect 1.0.

`test/scale.test.ts` repeats the labelled queries against a 400-memory corpus
(390 generated distractors plus the labelled set) and checks that recall holds,
that the work stays bounded, and that a second repository stays invisible. The
candidate budget is enforced **globally** across scope prefixes, not per prefix,
so a query cannot examine five times its intended work by matching five scopes.

**Known lexical limit:** the index matches tokens, not morphology. "which linter
do we use" does not retrieve "linting runs oxlint..." because `linter` and
`linting` are different tokens. That miss is pinned by a test, and the query
returns `no_match` with no invented result. Closing it means stemming or
embeddings, which §19 keeps out of V1.

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
| `trust.test.ts` | the promotion rules and tier admission, plus the same through `capture` |
| `storage.test.ts` | record integrity, corrupt records, failed writes, and the minidb backend on a real temp dir |
| `retrieval.test.ts` | recall, scopes, gates, ranking, budgets and every retrieval status |
| `lifecycle.test.ts` | expiry vs invalidation vs supersession vs deletion, canonical approval |
| `security.test.ts` | injection, cross-project isolation, redaction, authority forgery, unapproved promotion |
| `capture.test.ts` | idempotency, the review queue, retry/backoff, failure reporting |
| `continuity.test.ts` | task state save/restore, stale evidence, tool-output honesty |
| `injection.test.ts` | what actually reaches the model through the reminder providers |
| `maintenance.test.ts` | the scheduler: startup drain, debounce, poll, retention, overlap |
| `integration.test.ts` | the real DI graph: feature assembly, flag on/off, a real store on disk, queued work draining unattended |
| `Kernel/core/test/memory/agentMemory.test.ts` | a real agent turn: the model calls `memory_search` through the actual engine loop and sees the result |
| `tool.test.ts` | the `memory_search` contract, schema, approval rule and access counting |
| `concurrency.test.ts` | two openers on one store: the second reads, its writes fail loudly, the lock comes back |
| `process.test.ts` | a real second OS process holding the lock, via `test/fixtures/hold-store.mts` |
| `scale.test.ts` | 400 memories, on both the in-memory store and real minidb, including a reopen |
| `evaluation.test.ts` | measured ranking quality against the labelled corpus, stemming, and the no-match guarantee |
| `evidence.test.ts` | evidence freshness: changed, unchanged, unreadable, foreign, budgeted |

## Known limitations

- LLM-based distillation is deliberately absent. The review queue's processing
  is deterministic (dedupe, conflict resolution, policy gates); it never asks a
  model to summarise. Adding a model later means re-running the same trust
  gates, not bypassing them.
- A review that is queued and then killed with the process stays queued. The
  scheduler drains on the next start, so nothing is lost, but nothing guarantees
  completion before exit.
- Conflict detection needs an explicit `subject`. Without one, contradictions
  are stored side by side and only surfaced if the caller supplied a key.
- Evidence freshness is polled every 15 minutes against the files memories
  actually cite, not watched. A file edited between polls is detected late, and
  a file outside those references is never checked at all. `resetAccessCount()`
  is exposed for operators rather than wired to a schedule.
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