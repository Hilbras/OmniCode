# Release and Versioning

Status: active
Scope: versioning policy for the workspace; release flow and tooling for
`@omnicode/cli`. Does not change any package's runtime behavior.

## What is published

`@omnicode/cli` is the only published npm package (`publishConfig.access` is
`public`). Every package under `packages/` is private and stays in the
workspace; their versions exist so `workspace:^` ranges between packages stay
coherent when the CLI is published.

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
3. Publishing `@omnicode/cli` is currently a manual step for the release owner.
   The publish workflow is deliberately not written yet: npm trusted publishing
   (OIDC) needs registry-side configuration, and no publish token belongs in
   this repository.

## Release gates

Before a release, the release owner runs the full local gate
(`node scripts/preflight.mjs`, see `scripts/AGENTS.md`) plus the targeted
checks in `AGENTS.md` under "Definition of done". The existing CI workflows
(`ci.yml`, `release-gate.yml`, `cross-platform.yml`) are validation gates, not
publish pipelines.

## Not in place, deliberately

The items below need external infrastructure or credentials that do not exist
yet; see `docs/plans/deep-parity-plan.md` section 5.3 for the tracked reasons:

- OIDC trusted publishing and a publish workflow.
- SBOM and digest workflows for release artifacts.
- A Nix closure check (this tree has no `flake.nix`; `scripts/AGENTS.md`
  documents the legacy `check-nix-workspace.mjs` and says not to add a flake
  to satisfy it).
- Official plugins and a marketplace CDN — the CLI has local development and
  build scripts (`dev:plugin-marketplace`, `build:plugin-marketplace` in
  `apps/omnicode-cli/package.json`), but no hosted distribution endpoint.
- Desktop supervisor/updater and inspector panels — no desktop app exists in
  this tree.
