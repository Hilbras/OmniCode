# Advanced-strength program — decision record

Owner-gated decisions D1–D7 from `advanced-strength-program.md`, with the
evidence actually present in the tree on 2026-11-20. A "default recorded"
entry is the plan's own recommended default applied to a premise that was
already settled in code; it is reversible by an owner without code changes.

## D1 — Docs site: internal-only (already implemented)

`scripts/build-docs.mjs` renders `docs/` into untracked `docs-site/` and its
header records the evaluation: the workspace uses `marked`, a site framework
would add navigation chrome the repository does not need, and `docs/plans/**`
plus `AGENTS.md` are deliberately excluded as agent-facing notes. T5.8 already
made the call. No VitePress/search/mermaid/`llms.txt` dependency was added;
consequence: docs are a contributor artifact, not a published product surface.
Revisit only with a publishing owner and an infrastructure budget.

Evidence: `scripts/build-docs.mjs:3-12` (evaluation comment), `git ls-files
docs-site` (empty), `pnpm docs:check` OK.

## D2 — Desktop shell: keep `install-desktop` as a page pointer

The plan called the command "dangling". It is not: `apps/omnicode-cli/src/cli/sub/install-desktop.ts`
registers a working subcommand that opens the regional download page, with a
hidden `install-app` alias and a `/desktop` slash command; docs describe the
behavior in both languages. There is no desktop app source in this repository
to restore. Keep the pointer; the consequence is that desktop installation
stays a website responsibility, not a CLI packaging task.

Evidence: `apps/omnicode-cli/src/cli/sub/install-desktop.ts:17`,
`docs/en/reference/omnicode.md:225-233`, `docs/zh/reference/omnicode.md:225-233`.

## D3 — Nix / one-shot installers: out of scope

No `flake.nix` or installer script exists (the repository guide explicitly
says not to follow stale instructions requiring one). Distribution remains
with the website and package registries. Consequence: no reproducible
developer-environment story from this repo; reopen with a packaging owner.

Evidence: `AGENTS.md` "Adding a package" section, filesystem search for
`flake.nix`/`install.sh` returned nothing.

## D4 — Stall guard: on, cap 2, env opt-out

Landed in WS1.2 with `OMNICODE_STALL_GUARD=0`; the cap is now pinned by the
WS6.5 safety ledger. Loss accepted: at most two extra nudges per turn before
the model's final text stands. Escape hatch: the env opt-out.

## D5 — No-progress cap: 3

Landed in WS1.4 (`GOAL_NO_PROGRESS_LIMIT = 3`), pinned by the safety ledger.
Loss accepted: a stalled goal pauses after three evidence-free repeated
continuations rather than spinning indefinitely; the user can resume.

## D6 — Curator lifecycle: default recommendation recorded, not implemented

Recommended default: expose a read-only host surface. No such surface exists
yet; WS5.3 remains the implementation slot. Recorded so it is not silently
dropped.

## D7 — MCP elicitation: keep fail-closed

WS3.3 recorded the decision: enabling server-initiated elicitation would flip
a security default (`admitElicitation` is off unless enabled and allowlisted).
Re-baselining the three conformance gaps requires owner review. Consequence:
the official conformance pass set stays at four cells with three honest known
gaps; no guard or baseline was weakened.

Evidence: `packages/engine/src/mcpCore/resourceSurface.ts:212-227`,
`scripts/mcp-conformance-baseline.json`, `pnpm check:mcp-conformance` output.

## D8 — Pre-commit hooks: preflight replaces them (WS6.6)

There is no husky configuration and no `.git/hooks/pre-commit`. `pnpm preflight`
is the documented 17-step local delivery gate (install check, guards, lint,
full-graph typecheck, fourteen targeted suites, eval gate); CI enforces the
guard and lint layers on every PR. Adding a second, weaker local hook would
duplicate CI and create a place for drift. Consequence: a developer must run
`pnpm preflight` deliberately; there is no automatic commit-time stop.
Reopen if CI coverage loses a gate.

Evidence: `package.json` scripts (`preflight`, `check:guards`), `AGENTS.md`
"Definition of done" and "local delivery gate" sections, no husky/hook files.
