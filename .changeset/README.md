# Changesets

This repository uses [changesets](https://github.com/changesets/changesets) to manage npm package versions and releases.

## Package Publishing Strategy

This repository uses an **independent, manually-selected publishing** strategy. When generating a changeset, only select the publishable packages that this change actually affects. The repository's `.changeset/config.json` already filters out internal workspace packages via `ignore`, so only the publishable packages listed below should appear in the `pnpm changeset` prompt.

Current publishable packages:

| Package | Directory | Description |
| --- | --- | --- |
| `@hilbras/omnicode` | `apps/omnicode` | CLI / TUI application — provides the `omnicode` command after install |
| `@hilbras/omnicode-sdk` | `Kernel/SDK` | Public TypeScript SDK |

All other workspace packages are private internal packages, are not published to npm, and are excluded via `ignore` in `.changeset/config.json`:

- `@hilbras/omnicode-acp`
- `@hilbras/omnicode-auth`
- `@hilbras/omnicode-client`
- `@hilbras/omnicode-core`
- `@hilbras/omnicode-inspect`
- `@hilbras/omnicode-kaos`
- `@hilbras/omnicode-llm`
- `@hilbras/omnicode-migration`
- `@hilbras/omnicode-minidb`
- `@hilbras/omnicode-remote`
- `@hilbras/omnicode-server`
- `@hilbras/omnicode-telemetry`
- `@hilbras/omnicode-transcript`
- `@hilbras/omnicode-tree-sitter-bash`
- `@hilbras/omnicode-tui`
- `@hilbras/omnicode-vis`
- `@hilbras/omnicode-vis-server`
- `@hilbras/omnicode-vis-web`

Version impact from internal dependencies must be judged manually. The published artifacts for CLI and SDK bundle internal workspace packages into the artifact itself; runtime `dependencies` of published packages must not include any `@hilbras/*` internal workspace packages.

The repository's `.changeset/config.json` sets `updateInternalDependencies: "patch"`. Because internal packages are not published, you still need to manually select all affected publishable packages in the changeset — do not rely solely on automatic dependency bumps to express user-visible changes.

Example scenarios:

| Change | Changeset selection |
| --- | --- |
| Only modifies TUI behavior in `@hilbras/omnicode` | Add `patch` / `minor` / `major` to `@hilbras/omnicode` |
| Only modifies internal packages, no user-visible change in SDK / CLI | Usually no changeset needed |
| Internal package fix changes the CLI user experience | Add a changeset to `@hilbras/omnicode` describing the user-visible fix |
| Internal package adds a new capability exposed by the SDK | Add a changeset to `@hilbras/omnicode-sdk` |
| SDK behavior change affects CLI user experience | Add changesets to both `@hilbras/omnicode-sdk` and `@hilbras/omnicode` |
| Provider abstraction change affects SDK / CLI | Add changesets to the affected `@hilbras/omnicode-sdk` and/or `@hilbras/omnicode` |
| Test-only, internal refactor, docs, or private debug tooling changes | Usually no changeset needed |
| Bundled official plugin change under `plugins/` (e.g. `omnicode-datasource`) | No changeset — the plugin is versioned via its own `omnicode.plugin.json` / `plugins/marketplace.json` and shipped through the marketplace CDN, not the npm package |

## Prerequisite: NPM Trusted Publishing (OIDC)

This repository uses npm's **Trusted Publishing** (OIDC-based) for publishing — no `NPM_TOKEN` is required.

### Configuration steps

1. Open each publishable package's page on the npm website, e.g. `https://www.npmjs.com/package/@hilbras/omnicode`.
2. Go to **Settings** -> **Publishing access**.
3. Find **Automate publishing with GitHub Actions** or **Add trusted publisher**.
4. Click **Add a new trusted publisher**.

Fill in the following:

| Field | Value |
| --- | --- |
| GitHub Organization | `hilbras` |
| GitHub Repository | `omnicode` |
| GitHub Workflow | `release.yml` |
| Environment | leave empty |

Each publishable package needs its Trusted Publisher configured once. The current GitHub Actions workflow lives at `.github/workflows/release.yml` and already has `id-token: write` configured.

## Development Workflow

### 1. Implement the feature or fix

Complete code, tests, and documentation changes as usual. A changeset is required when the change affects user-visible behavior, public API, dependency ranges, or release artifacts of a publishable package.

### 2. Generate a changeset

From the repository root:

```sh
pnpm changeset
```

Follow the prompts to choose:

- Which publishable packages this change affects;
- The version bump level:
  - `patch`: bug fixes, small changes, follow-up dependency updates;
  - `minor`: backward-compatible new features;
  - `major`: breaking changes;
- A user-facing description of the change.

The command creates a `.changeset/*.md` file that must be committed alongside the code.

### 3. Commit the changeset

```sh
git add .changeset/
git commit -m "chore: add changeset for package release"
git push
```

Commit messages must follow Conventional Commit style. Do not include any author/agent identity in the commit message.

### 4. Cut the release version

Once the changeset file is merged into `release`, cut the release version locally:

```sh
pnpm run version:release
git commit -m "chore(release): <version>"
git push
```

`pnpm changeset version` bumps the publishable package versions, updates the changelogs and deletes the consumed `.changeset/*.md` files. It needs a `GITHUB_TOKEN` in the environment, because the changelog generator resolves the commit links through the GitHub API:

```sh
GITHUB_TOKEN="$(gh auth token)" pnpm run version:release
```

### 5. Publish

Publish the versioned tree with the release workflow, or with the local gate below.

`.github/workflows/release.yml` runs on demand (`workflow_dispatch`) and performs the whole release: validate, test, build, inspect the tarball, publish, then verify the registry.

```sh
gh workflow run release.yml -f version=1.2.1
```

It publishes through npm Trusted Publishing, so it needs no long-lived npm token — but the package must be configured for trusted publishing on npm.com first (package settings → Trusted Publisher → this repository, the `release` workflow). Until that is done, publish locally.

## Manual Publishing (Not Recommended)

Only publish manually when CI is unavailable. Before publishing manually, make sure you are logged into npm locally and using the Node.js and pnpm versions required by the repository.

```sh
GITHUB_TOKEN="$(gh auth token)" pnpm run version:release
pnpm run release:publish
```

The underlying changesets commands are:

```sh
pnpm changeset version
```

`pnpm run release:publish` first runs typecheck, lint, sherif, test, build, and package lint, then publishes `@hilbras/omnicode` with `npm publish`. It does not call `changeset publish`: with pnpm as the package manager, `changeset publish` runs `pnpm publish` in the repository root instead of the package directory, so it targets the root package and never publishes the CLI.

The script is named `release:publish` rather than `publish` on purpose. A script named `publish` is an npm lifecycle hook, so `npm publish` or `pnpm publish` in the repository root would run this whole gate as a side effect of publishing the root package, which is never what anyone wants.

## Notes

- Every PR that affects publishable-package behavior or public API should include a corresponding changeset.
- Changes under `plugins/` (the bundled official plugins such as `omnicode-datasource`) do **not** need a changeset: each plugin carries its own version in `omnicode.plugin.json` and `plugins/marketplace.json` and is distributed via the marketplace CDN, separately from the `@hilbras/omnicode` npm package.
- Changeset files must be committed to the repository — release PRs are only triggered after they're merged.
- Release PRs require human review and merge; they will not publish automatically.
- Do not add release changesets for private internal packages; only select `@hilbras/omnicode` and `@hilbras/omnicode-sdk`.
- If a change in an underlying internal package alters user-visible behavior or public API of a publishable package, add a changeset to the affected publishable package. For example, when a bug fixed in `@hilbras/omnicode-llm` resolves an issue CLI users encounter, add a changeset to `@hilbras/omnicode` describing the user-visible fix.
- `@hilbras/omnicode` is the official CLI package name; after a global install it provides the `omnicode` command.
- Make sure each publishable package on npm has a Trusted Publisher configured.

## References

- [Changesets documentation](https://github.com/changesets/changesets)
- [Changesets GitHub Action](https://github.com/changesets/action)
- [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers)
