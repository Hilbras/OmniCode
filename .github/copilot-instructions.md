# OmniCode

Read `AGENTS.md` at the repository root and the nearest package or app
`AGENTS.md` before changing code.

Critical rules:
- Kernel layering is enforced by `scripts/check-kernel-layering.mjs`.
- `packages/core` is a facade over `packages/base` + `packages/engine`.
- CLI uses `@hilbras/omnicode-api`/SDK, not engine internals. `apps/omnicode-vis` is a read-only exception; do not extend it.
- Run `pnpm check:guards` before finishing.
