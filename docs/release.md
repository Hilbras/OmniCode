# Release and Versioning

Status: active
Scope: versioning policy for the workspace; release flow and tooling for
`@hilbras/omnicode`. Does not change any package's runtime behavior.

## What is published

`@hilbras/omnicode` is the only package in the documented publish flow
(`publishConfig.access` is `public`). Every package under `packages/` is private
and stays in the workspace; their versions exist so `workspace:^` ranges between
packages stay coherent when the CLI is published.

The published CLI embeds a **vendored web bundle** at
`apps/omnicode-cli/dist-web` (746 files, ~37 MB). It is built in the separate
`code-app` repository (`apps/web`) and synced into this checkout; it cannot be
regenerated here. `apps/omnicode-cli/scripts/check-web-assets.mjs` verifies the
bundle is present before packaging, and `pnpm check:cli-artifact` verifies the
bundled CLI starts and reports its version. When the bundle changes, re-run the
`code-app` sync (`OMNICODE_REPO=<this checkout> pnpm run sync:web`) and commit
`dist-web` together with the source change that produced it.

Two of them nevertheless declare a packed publish surface:
`@hilbras/omnicode-sdk` and `@hilbras/omnicode-tui` set
`publishConfig.access: "public"` and a `publishConfig.exports` override that repoints
`.` at `dist/`. Both are `private: true`, so no publish flow can ship them — the
declaration exists because `pnpm check:package` packs them and runs `publint`/`attw`
against that surface, which is what keeps the packed manifest honest. That resolves the
older contradiction here: **the CLI is the only published package; SDK and TUI stay
private and are held to their declared packed surface by the hygiene gate.**

**Publish with `pnpm`.** `publishConfig.exports` is what makes the packed manifest
resolvable — the top-level `exports` point at `src/`, which `files` deliberately
excludes. `pnpm publish`/`pnpm pack` apply the override; `npm publish`/`npm pack`
ignore it, so an npm publish would ship a manifest whose entry point is not in the
tarball at all. `pnpm check:package` verifies the pnpm path by packing and running
`attw` on the tarball. `@hilbras/omnicode` now publishes with `provenance: true`, so a
local `pnpm publish` is expected to fail: provenance is only available from CI with an
OIDC token.

## Automation

`.github/workflows/release.yml` runs on every push to `main` in two gated phases:

1. `verify` calls the reusable `release-gate.yml` (guards, typecheck, build, test). A
   red gate stops the pipeline before anything is published.
2. `release` runs `changesets/action`: it opens or updates the "Version Packages" PR
   (`pnpm release:version`), and once that PR merges it publishes (`pnpm release`) and
   creates the GitHub Release with the changelog.

Secrets live in the repository's `release` **environment**, never in the tree:

| Secret | Purpose | Notes |
|---|---|---|
| `NPM_TOKEN` | npm automation token scoped to `@omnicode` | `actions/setup-node` writes it into the runner's `.npmrc` as `NODE_AUTH_TOKEN`; the workflow warns (rather than fails) when it is absent so the version PR still works |
| `GITHUB_TOKEN` | push the version branch, tag, create the Release | automatic; the job grants `contents: write` and `pull-requests: write` |
| OIDC (`id-token: write`) | npm provenance | no long-lived secret; with npm trusted publishing configured, `NPM_TOKEN` can be removed entirely |

Concurrency is serialized per ref (`release-${{ github.ref }}`), so two merges cannot
race the same version bump. A local dry run of the verification phase is
`pnpm release:gate`; the workflow itself only runs on GitHub.

## Versioning policy

Versions are managed with [changesets](https://github.com/changesets/changesets).
The policy is pinned in `.changeset/config.json`:

- Private packages are versioned and receive changelog entries
  (`privatePackages.version: true`) but are never published or tagged.
- No `fixed` or `linked` groups: packages keep independent versions.
- Internal dependency bumps from a package change are patch-level
  (`updateInternalDependencies`).
- User-visible behavior changes travel with a changeset describing the
  behavior, not the diff.

## Release flow

1. A PR that changes user-visible behavior carries a changeset
   (`.changeset/README.md` documents the authoring step).
2. On `main`, `changeset version` consumes accumulated changesets: it bumps the
   listed packages, updates `workspace:^` ranges, and appends to each package's
   `CHANGELOG.md`. The result is committed as a "Version Packages" commit.
3. Publishing is CI-driven: merging the “Version Packages” PR makes
   `changesets/action` run `pnpm release`, which publishes `@hilbras/omnicode` and
   creates the GitHub Release. A local `pnpm publish` is not the supported path
   (provenance requires CI); see “Automation” above.

## Release gates

Before a release, the release owner runs the full local gate
(`node scripts/preflight.mjs`, see `scripts/AGENTS.md`) plus the targeted
checks in `AGENTS.md` under "Definition of done". The existing CI workflows
(`ci.yml`, `release-gate.yml`, `cross-platform.yml`) are validation gates, not
publish pipelines.

## Not in place, deliberately

The items below need external infrastructure or credentials that do not exist
yet; see `docs/plans/deep-parity-plan.md` section 5.3 for the tracked reasons:

- SBOM and digest workflows for release artifacts.
- A Nix closure check (this tree has no `flake.nix`; `scripts/AGENTS.md`
  documents the legacy `check-nix-workspace.mjs` and says not to add a flake
  to satisfy it).
- Official plugins and a marketplace CDN — the CLI has local development and
  build scripts (`dev:plugin-marketplace`, `build:plugin-marketplace` in
  `apps/omnicode-cli/package.json`), but no hosted distribution endpoint.
- Desktop supervisor/updater and inspector panels — no desktop app exists in
  this tree.
