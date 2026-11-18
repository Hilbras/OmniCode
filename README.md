# OmniCode-V

Monorepo for the OmniCode agent runtime and its surfaces. Kernel packages provide
the engine, tool, permission, session, and provider layers; the CLI and the
visualisation apps sit on top of them through the SDK/API boundary.

This file is the entry point for someone opening the repository. It does not
duplicate product documentation — the authoritative sources are:

| Read | For |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | The canonical agent guide: package map, layering laws, guards, commands, review rules |
| [`apps/omnicode-cli/README.md`](./apps/omnicode-cli/README.md) | Product usage: install, quick start, features, providers |
| [`packages/API/docs/wire-contract.md`](./packages/API/docs/wire-contract.md) | API reference: every service method and event on the client boundary (generated) |
| [`packages/README.md`](./packages/README.md) | The package map and the checklist for adding one |
| [`docs/`](./docs) | Plans and architecture notes (`docs/plans/`) |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How work lands here |

## Requirements

- Node `>=22.19` (`.nvmrc` pins 22)
- `pnpm@12.5.1` (declared as `packageManager`; the workspace lives in `pnpm-workspace.yaml`)

## Quick start

```bash
pnpm install
pnpm dev:cli        # run the CLI from this checkout
```

## Validate

```bash
pnpm typecheck      # every package, via turbo
pnpm test           # every package's test suite
pnpm check:guards   # workspace, layering, docs, generated-artifact freshness, skill validators
pnpm preflight      # the local delivery gate: guards, typechecks, targeted suites, eval gate
```

`pnpm test` on this machine needs `--concurrency=1`: several suites are
memory-bound, and four-way Turbo parallelism has been observed to OOM-kill them.
CI runs the same command serially.

## Layout

| Path | Role |
|---|---|
| `packages/*` | Kernel packages (`base`, `auth`, `Kaos`, `llm`, `minidb`, `tui`, …), the engine, tools, memory, the SDK/API/ACP surfaces, and the app-* UI packages |
| `apps/omnicode-cli` | The CLI and its terminal UI — the published surface |
| `apps/omnicode-inspect` | Read-only inspector over the loopback debug service channels |
| `apps/omnicode-vis` | Read-only visualisation daemon and web app over on-disk session artifacts |
| `apps/omnicode-mobile` | Expo/React Native app; the agent loop is still a preview (see its `README.md`) |
| `scripts/` | Repository guards, generators, and the preflight runner (`scripts/AGENTS.md`) |

Import direction is enforced, not conventional: leaf packages import nothing from
`@hilbras/omnicode-*`, `engine` imports leaves only, `core` is a facade over
`base` + `engine`, and nothing imports `server` or (except `api`) `acp`. See
`AGENTS.md` § "Hard laws" and `pnpm check:architecture`.

## License

Each package declares its own license in its `package.json`; the kernel and app
packages are MIT. No root `LICENSE` file exists in this checkout.
