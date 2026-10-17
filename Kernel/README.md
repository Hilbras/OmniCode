# Kernel

Holds the packages that connect the rest of the repository to each other. Systems
reach these through `Kernel/API` rather than importing each other directly.

## Contents

| Package | Name | Role |
|---|---|---|
| `API` | `@hilbras/api` | the single connection surface between kernel packages; re-exports the SDK |
| `SDK` | `@hilbras/agent-sdk` | the public TypeScript SDK and harness |

## Current status

| | |
|---|---|
| pnpm workspace | yes — `pnpm-workspace.yaml` globs `Kernel/*` |
| Nix build | `flake.nix`'s `workspacePaths` and `workspaceNames` list both packages |
| vitest | the root `vitest.config.ts` project glob covers `Kernel/*/vitest.config.ts` |

`Kernel/SDK` was moved from `packages/omnicode-sdk`. Its package name and public
exports are unchanged, so nothing outside this repository had to be updated.

## Wiring to remember

Adding a package under `Kernel/` needs four manual edits, all of which fail
silently when missed: the pnpm workspace globs, `flake.nix` (an explicit fileset,
not globs), the root `vitest.config.ts` project glob (an unmatched project root
stops its tests from running while the suite still reports green), and the
`--filter './Kernel/*'` arguments in the root `build:packages` and `typecheck`
scripts.