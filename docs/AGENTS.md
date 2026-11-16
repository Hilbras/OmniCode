# docs/ — Agent Guide

## Role

Repository-level architecture notes, upgrade plans, and design decisions that
span packages. Current contents are sparse and plan-oriented:

- `memory-upgrade-plan.md` — memory package upgrade scope and phases
- `telegram-upgrade-plan.md` — original Telegram connector plan
- `telegram-upgrade-plan-v2.md` — supersedes the original Telegram plan
- `release.md` — versioning policy, changesets flow, and what is deliberately
  not built yet on the release surface
- `plans/qwen-parity-improvement-plan.md` — seven-workstream qwen-parity plan
  (marked complete; superseded by `plans/strength-program.md`)
- `plans/strength-program.md` — active competitive-strength program (T0–T5),
  consolidating the Codex / qwen-code / old-OmniCode study
- `en/architecture/` and `zh/architecture/` — bilingual architecture and
  workstream status, English as source of truth
- `en/quality/` and `zh/quality/` — bilingual E2E test plan and memory recall
  evaluation baseline, English as source of truth

These are working plans and internal design notes, not published user
documentation or generated API reference.

Rendering and checking: `pnpm docs:build` renders the reader-facing documents
(`README.md`, `CONTRIBUTING.md`, `docs/en`, `docs/zh`, `docs/release.md`, the CLI README,
the generated wire contract) into `docs-site/` (gitignored) with `scripts/build-docs.mjs`.
`pnpm docs:check` — part of `pnpm check:guards` — validates them without writing: every
relative link must resolve, and every `docs/zh/<path>` needs its `docs/en/<path>` source.
`docs/plans/**` and all `AGENTS.md` files are agent working notes, deliberately excluded.

Non-goals:

- no CLI/TUI usage guide; product docs live with the CLI app and its README
- no per-package implementation detail; use the nearest `AGENTS.md` or package
  README
- no generated manifests or reference tables that an owning script must produce
- no duplicate architecture rules from the root `AGENTS.md`

## Bilingual status

`docs/en/` and `docs/zh/` now exist for the architecture and quality areas
listed above. English is the source of truth for both trees; every mirrored
document carries a cross-link and states that rule. Keep matching relative
paths and keep the two versions structurally aligned.

Do not invent a bilingual mirror for a document that never had one, and do not
add a language tree on one side only. Existing single-language plans stay
single-language unless the task explicitly asks for translation. Package-level
bilingual docs only exist under `packages/engine/docs/en/` and
`packages/engine/docs/zh/`; do not move or mirror them here.

## Writing rules

- Give every plan a status and a scope line: which packages and surfaces it
  changes, and whether it is proposed, active, or superseded.
- When a plan replaces another, say so at the top and link the old file. The
  Telegram v2 document is the model for this.
- Use real paths from this tree (`packages/*`, `apps/omnicode-cli`); verify a
  referenced path exists before linking it.
- Describe behavior changes and their migration path, not only the desired end
  state. Note defaults that flip and the escape hatch.
- Do not claim CI or test results from a plan document.
- Prefer linking to the owning source and tests over copying signatures that will
  drift.

## Ownership and boundaries

- This directory is documentation only. Do not add executable scripts or build
  inputs here.
- Root `AGENTS.md` owns the hard rules. Package `AGENTS.md` files own local
  rules. This file must not fork them.
- If a plan becomes implemented, either update it with the outcome or leave a
  short superseded note pointing at the code and the current plan.

## Validation

No automated documentation tests exist. Before handoff:

```bash
pnpm check:agent-docs
pnpm check:guards
```

`check-agents-docs.mjs` validates `AGENTS.md` references and compatibility
files, not prose in this directory. Manually verify that every relative link
resolves and every referenced path exists. Do not report docs as tested when
only a spell-check-like review was done.
