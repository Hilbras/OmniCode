# Changesets

This workspace uses [changesets](https://github.com/changesets/changesets) for
versioning. The policy is pinned in `config.json`:

- `@omnicode/cli` is the only published package (`access: "public"`, matching
  its `publishConfig`).
- The private `@hilbras/*` packages are versioned and get changelog entries
  (`privatePackages.version: true`) but are never published or tagged
  (`tag: false`). Their versions advance so `workspace:^` ranges stay coherent
  at publish time.
- No `fixed` or `linked` groups: packages keep independent versions.
- Internal dependency bumps are patch-level (`updateInternalDependencies`).

## Release flow

The `@changesets/cli` tool is deliberately not installed yet — adding it edits
`pnpm-lock.yaml`, which is shared with in-flight work. When the publishing step
lands, install it first:

```bash
pnpm add -Dw @changesets/cli
```

Then:

1. Contribute a change with a changeset describing the user-visible behavior:

   ```bash
   pnpm exec changeset
   ```

   Changesets accumulate as markdown files in this directory and travel with
   the PR.

2. On `main`, consume them:

   ```bash
   pnpm exec changeset version
   ```

   This bumps each listed package, updates the workspace `workspace:^`
   ranges, and appends to each package's `CHANGELOG.md`. Commit the result
   as a "Version Packages" commit.

3. Publish. The publish workflow is intentionally not written yet — npm
   trusted publishing (OIDC) needs registry-side configuration first, and no
   publish token belongs in this repository. Until then, publishing stays a
   manual step for the release owner.

See `docs/release.md` for the full versioning policy and
`CONTRIBUTING.md` for what belongs in a changeset entry.
