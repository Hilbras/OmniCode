## Summary

What changes behaviorally? Enumerate changed behavior, not only changed lines.
For a refactor or port, carry the previous feature inventory — silently
dropped features are regressions.

## Motivation

Link the plan section, issue, or problem this addresses. If a default flips,
name the loss and the escape hatch.

## Changes

-

## Validation

Run the checks that match your change type (see `AGENTS.md`, "Definition of
done") and state the real result — a skipped suite or an existing failure is
not green, and a CI run only counts if it actually ran.

- [ ] `pnpm check:guards`
- [ ] Affected package typecheck and tests (name the commands and results)
- [ ] CLI/TUI change: `pnpm --filter @hilbras/omnicode typecheck` and build
- [ ] Memory change: `pnpm --filter @hilbras/omnicode-memory test` and engine typecheck
- [ ] Package-graph change: `pnpm check:workspace` and `pnpm check:architecture`
- [ ] Bug fix or behavior change has a test that fails on the base and passes on the fix
- [ ] Generated manifests regenerated from the owning scripts, not hand-edited
- [ ] Nearest `AGENTS.md` updated if a documented path, command, guard, or rule changed

## Notes for reviewers

Prompt text is behavior. Contract files are tripwires. Silent failure outranks
a crash. Do not self-approve a major release or a breaking API change.
