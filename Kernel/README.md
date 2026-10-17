# Kernel

Step 1 of a planned restructure of this repository.

This folder is intentionally empty for now. Its contents, and what moves into it, are
not decided yet — see "Open questions" below.

## Current status

| | |
|---|---|
| Created | as an empty directory, ahead of the work that fills it |
| pnpm workspace | **not** a workspace package — `pnpm-workspace.yaml` globs only `packages/*`, `apps/*`, and `docs` |
| Nix build | listed in `flake.nix`'s fileset, so it is not silently dropped from the source |

## Open questions

These are deliberate, not oversights. Answering them decides what this folder becomes:

1. **What goes here?** The engine internals, a shared runtime, a spec, or something else.
2. **What moves into it?** Nothing has been moved. No existing code was relocated to
   create this folder.
3. **Does it stay outside `packages/`?** If the contents become a workspace package, the
   workspace globs and `flake.nix`'s `workspacePaths` both need updating, and the layout
   stops being a purely structural folder.