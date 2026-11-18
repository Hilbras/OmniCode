# Memory Upgrade Plan — Remembra-informed

Source study: `/home/gin/work/Hilbras/Remembra` v5.7.1.
Scope: `packages/memory` plus the API/CLI surfaces needed to expose the new
behavior.

Baseline already implemented:

- trust-gated records, provenance, evidence freshness, suspicion gate
- 5 scope tiers: global, workspace, repository, session, task
- 3 tiers: working, distilled, canonical
- lexical retrieval with explicit budgets and partial/complete reporting
- `/memory` control surface and MCP tools
- agent profiles include `memory_search`, `memory_save`, `memory_forget`
- memory tools are auto-approved
- explicit `memory_search` includes unverified memories by default

## Definition of done

- All phases below implemented.
- `pnpm --filter @hilbras/omnicode-memory test` passes.
- `pnpm --filter @hilbras/omnicode-engine typecheck` passes.
- `pnpm --filter @hilbras/omnicode typecheck` passes.
- `pnpm --filter @hilbras/omnicode build` passes.
- No new retrieval result is returned without provenance and trust.

## Phase 1 — Result dedup and superseded suppression

### Goals

Stop returning the same fact several times and avoid hiding a superseded fact
when its replacement is absent.

### Tasks

1. Exact result dedup after ranking:
   - key = scope prefix + category + normalized search text
   - keep the highest ranked record
   - bounded window (200 results)
2. Same-source dedup:
   - optional flag `dedupeSameSource` default off
   - key = sourceType + origin + normalized text
3. Superseded handling:
   - lifecycle gate admits `superseded`
   - after ranking, drop a superseded record only when `supersededBy` is in
     the ranked pool
   - otherwise keep it and mark it as superseded
4. Report dropped duplicates in diagnostics.
5. Tests:
   - exact duplicates
   - same-source duplicates
   - superseded with successor present
   - superseded without successor

### Acceptance

- A query returning two identical facts yields one result.
- A superseded memory is hidden only when its successor is also retrievable.
- Diagnostics say how many duplicates were removed.

## Phase 2 — Typed relation graph and bounded expansion

### Goals

Answer “why” and “what changed” questions by traversing a small closed set of
typed relations.

### Tasks

1. Add relation kinds:
   `supports`, `contradicts`, `supersedes`, `refines`, `duplicates`,
   `related`, `caused`, `invalidated_by`.
2. Extend the record schema with `relations[]`.
3. Store relation indexes:
   - `r:<id>:<kind>:<targetId>`
   - reverse index `rb:<targetId>:<kind>:<sourceId>`
4. Retrieval expansion:
   - depth 1 by default, max 2
   - max 32 edges
   - only nodes already authorized by scope and trust
5. Ranking:
   - direct hit > support/refine > related
   - contradiction is returned with a warning, not silently merged
6. Tests:
   - supersedes chain
   - contradiction pair
   - edge cap
   - scope isolation

### Acceptance

- Retrieval can return a bounded causal chain.
- Expansion never crosses scope or trust authorization.
- Contradictions are visible, not hidden.

## Phase 3 — Digest and consolidation

### Goals

Turn a conversation or batch into durable memories without duplicate spam.

### Tasks

1. Deterministic digest first:
   - normalize type + scope + content
   - exact key match
   - Dice bigram similarity >= 0.9 with digit-sequence guard
2. Optional LLM adjudication:
   - `store | skip | merge`
   - provider failure fails open to `store`
3. Merge semantics:
   - update content/tags/importance
   - write pre-image to version history
   - record reason and actor
4. Consolidation pass:
   - exact duplicates
   - near-duplicates at >= 0.92
   - contradiction heuristic
   - 3+ short memories in same type/scope within 7 days
5. Tests:
   - exact digest
   - fuzzy digest with different quantities
   - merge keeps pre-image
   - provider failure stores fresh

### Acceptance

- Digesting the same episode twice creates one memory.
- A merge is recoverable from history.
- A provider outage does not lose the new memory.

## Phase 4 — Version history and audit

### Goals

Make every merge, supersede, confirm, and forget recoverable and inspectable.

### Tasks

1. `memory_versions` store:
   - id, revision, content, metadata, reason, actor, timestamp
   - default retention 20 versions
2. Write pre-image on update, merge, supersede, invalidate.
3. Content-free audit records:
   - actor, operation, effect, reason, resource class
   - never store memory content
4. API:
   - `memory history <id>`
   - `/memory history <id>`
5. Tests:
   - merge history
   - supersede history
   - history cap
   - audit has no content

### Acceptance

- Any destructive mutation has a recoverable pre-image.
- Audit records are content-free.
- History is bounded.

## Phase 5 — Sensitivity bands and provider egress

### Goals

Separate “may read” from “may send to a model/provider”.

### Tasks

1. Add sensitivity:
   `public | internal | confidential | secret`.
2. Default `internal`.
3. Retrieval filters by sensitivity ceiling.
4. Provider egress gate:
   - requires explicit `provider:transmit` capability
   - `secret` never leaves the host
5. Redaction remains before storage/egress.
6. Tests:
   - ceiling filter
   - secret never transmitted
   - audit records egress denial without content

### Acceptance

- A secret memory cannot reach a provider.
- Retrieval can be capped below the record sensitivity.
- Egress denial is auditable.

## Phase 6 — Retention modes and legal hold

### Goals

Prevent important memories from expiring accidentally and allow operator holds.

### Tasks

1. Add retention:
   `pinned | persistent | ephemeral | decaying | neverExpire`.
2. `expiresAt` independent of retention.
3. Legal hold:
   - blocks delete, archive, supersede
   - never blocks read
   - excludes from retrieval unless explicitly requested
4. Lifecycle precedence:
   `deleted > expired > superseded > archived > active`.
5. Tests:
   - pinned survives
   - ephemeral expires
   - legal hold blocks mutation
   - held memory still readable by id

### Acceptance

- Retention and expiry do not contradict each other.
- Legal hold is enforced on mutation, not read.

## Phase 7 — Ranking modifiers and budget report

### Goals

Rank by more than lexical overlap while keeping budgets honest.

### Tasks

1. Add `importance` 1–5 and `confidence` 0–1.
2. Ranking modifiers:
   - importance
   - confidence
   - bounded recency
   - provenance/source
   - pinned retention
3. Keep existing trust, scope, access, and relevance gates.
4. Budget report:
   - `maxItems`
   - `maxBytes`
   - `maxLatencyMs`
   - `truncatedBy`
   - `droppedByBudget`
5. Tests:
   - importance moves rank
   - recency decays
   - byte budget reports truncation
   - first result is always admitted

### Acceptance

- Higher-confidence, higher-importance memories rank above equal lexical
  matches.
- Truncation is explicit and machine-readable.

## Phase 8 — Feedback-driven trust recalibration

### Goals

Use explicit usefulness feedback without letting raw retrieval counts promote
memory.

### Tasks

1. Feedback store:
   - `useful | harmful | irrelevant`
   - actor, memory id, turn id, timestamp
2. Recalibration:
   - one level per pass
   - 3+ useful with positive net → promote one step
   - 2+ harmful with negative net → demote one step
   - 7-day cooldown
   - never touch `system`
   - `unverified → trusted` requires explicit user/authority confirmation
3. Metrics:
   - promoted, demoted, skipped, cooldown
4. Tests:
   - promotion threshold
   - demotion threshold
   - cooldown
   - system memory unchanged
   - raw access count never promotes

### Acceptance

- Feedback can move trust only one step and only with net signal.
- System memory is immutable through feedback.
- Raw retrieval counts alone never promote.

## File map

- `packages/memory/src/contracts/memoryTypes.ts`
- `packages/memory/src/contracts/memoryContract.ts`
- `packages/memory/src/contracts/retrieval.ts`
- `packages/memory/src/retrieval/memoryRetriever.ts`
- `packages/memory/src/retrieval/ranking.ts`
- `packages/memory/src/retrieval/budget.ts`
- `packages/memory/src/storage/memoryKeys.ts`
- `packages/memory/src/storage/memoryStore.ts`
- `packages/memory/src/storage/minidbMemoryStore.ts`
- `packages/memory/src/service/memoryService.ts`
- `packages/memory/src/service/recordFactory.ts`
- `packages/memory/src/control/*`
- `packages/memory/src/tool/*`
- `packages/API/src/requestHandler.ts`
- `apps/omnicode-cli/src/tui/commands/memory.ts`

## Risks

- Relations and expansion can widen context unexpectedly; keep depth and edge
  caps hard.
- Digest merge can overwrite facts; always write a pre-image and fail open.
- Sensitivity and egress gates must fail closed.
- Feedback can be gamed; never allow raw access counts to promote.
- Superseded fallback must be explicit, not silent.
