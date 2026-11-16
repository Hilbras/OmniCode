# Plugin marketplace catalog — source, licence and security audit

Status: audit complete, **nothing imported**. `plugins/` remains untracked; no third-party
code ships in this repository. Every entry below is either first-party (tier `official`)
or a curated third-party reference, and the two are kept separate: only
`plugins/official/` may contain vendored code, and only after the licence is verifiable
in-tree.

Catalog: `plugins/marketplace.json`, seven entries. Audit date 2026-11-17.

## Summary

| Entry | Tier | Source verified | Licence | Recommendation |
|---|---|---|---|---|
| `omnicode-datasource` | official | in-tree (`plugins/official/omnicode-datasource`) | **none in-tree** | **HOLD** — no `LICENSE`, no plugin manifest |
| `omnicode-webbridge` | official | **missing** (`./official/omnicode-webbridge` does not exist) | — | **REJECT** as shipped — dead entry |
| `omnicode-telegram` | official | **missing** (`./official/omnicode-telegram` does not exist) | — | **REJECT** as shipped — dead entry |
| `superpowers` | curated | `github.com/obra/superpowers` | MIT | **HOLD** — licence fine, needs an OmniCode manifest + permissions |
| `vercel-plugin` | curated | `github.com/vercel/vercel-plugin` | Apache-2.0 | **HOLD** — licence fine; telemetry on by default, MCP is read+write |
| `modern-web-guidance` | curated | `github.com/GoogleChrome/modern-web-guidance` | Apache-2.0 (code), CC-BY-4.0 (content) | **HOLD** — licence fine; installs and fetches at runtime |
| `cloudbase` | curated | `github.com/TencentCloudBase/CloudBase-AI-Toolkit`, zip from its releases | MIT | **HOLD** — licence fine; high-privilege backend MCP |

No entry reaches **Accept** today. The blockers are compatibility (OmniCode manifest and
declared permissions) for the four curated ones, and integrity (missing licence, missing
manifest, missing source directory) for three official ones.

## Per-entry findings

### `omnicode-datasource` (official) — HOLD

- **Source:** in-tree, single file `bin/omnicode-datasource.mjs` (v3.4.0), a stdio
  MCP/JSON-RPC server implemented with Node built-ins only.
- **Author / ownership:** first-party OmniCode content.
- **Licence:** **no `LICENSE` file anywhere under `plugins/`** — redistribution status
  unverifiable from the tree. Under the owner's rule that is a HOLD, even for
  first-party code.
- **Dependencies:** none beyond Node built-ins (`crypto`, `fs/promises`, `os`, `path`,
  `readline`) — good.
- **Security:** talks to `https://api.omnicode.com/coding/v1` and an OAuth host; persists
  a cache under the user's home; 30 s request timeout. No subprocess, no shell.
- **Maintenance:** in-tree, versioned with the catalog.
- **Compatibility:** **no `omnicode.plugin.json`** in the directory, so the engine's
  manifest parser would refuse to load it; the catalog's `source` is not a loadable
  plugin as shipped.
- **Action:** add a licence file and a manifest with `permissions.mcpServers: true`,
  then re-audit.

### `omnicode-webbridge` (official) — REJECT as shipped

- **Source:** `./official/omnicode-webbridge` — **the directory does not exist** in the
  tree. The entry cannot install.
- Everything else (licence, author, dependencies) is unverifiable because there is no
  code. Restore the source or drop the entry.

### `omnicode-telegram` (official) — REJECT as shipped

- **Source:** `./official/omnicode-telegram` — **the directory does not exist**. Same
  finding as webbridge.

### `superpowers` (curated) — HOLD

- **Source / repository:** [obra/superpowers](https://github.com/obra/superpowers)
  (verified).
- **Author / ownership:** Jesse Vincent and Prime Radiant.
- **Licence:** **MIT** (LICENSE file referenced by the README).
- **Dependencies:** agent instruction content (skills) plus Node scripts for its own
  tooling; installs through each harness's plugin mechanism.
- **Security:** ships skills that steer agent behaviour; an optional visual companion
  loads a logo from the vendor's site and reports the version — **telemetry, opt-out via
  `SUPERPOWERS_DISABLE_TELEMETRY`**. No MCP server, no subprocess on load.
- **Maintenance:** active, wide harness support.
- **Compatibility:** harness plugin format (Claude/Codex/Cursor/…), not OmniCode's
  `omnicode.plugin.json`; skills would map to OmniCode's skill contributions, hooks would
  need `permissions.hooks`.
- **Action:** author an OmniCode adapter manifest with `permissions.hooks` and
  `permissions.skills`, document the telemetry switch, then re-audit.

### `vercel-plugin` (curated) — HOLD

- **Source / repository:** [vercel/vercel-plugin](https://github.com/vercel/vercel-plugin)
  (verified).
- **Author / ownership:** Vercel.
- **Licence:** **Apache-2.0**.
- **Dependencies:** Node 18+/Bun for hooks; 38 skills, 3 agents, 4 commands; `.mcp.json`
  pointing at `https://mcp.vercel.com`.
- **Security:** **telemetry is on by default** (`VERCEL_PLUGIN_TELEMETRY=off` disables
  it) with a documented, narrow event set — still a privacy decision the host must
  surface. The MCP connection supports **reads and writes** (deployments, resources), so
  it is a high-privilege integration: `permissions.mcpServers` is mandatory, and the
  host's approval policy must not auto-approve it. Hooks execute Node code.
- **Maintenance:** active; upstream skill sync with a CI staleness check.
- **Compatibility:** harness plugin manifest, not OmniCode's; hooks and MCP need
  permissions.
- **Action:** adapter manifest with `permissions.{hooks,mcpServers}`, surface the
  telemetry default in the install UI, keep it non-auto-approved.

### `modern-web-guidance` (curated) — HOLD

- **Source / repository:** [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
  (verified), source repo `modern-web-guidance-src`.
- **Author / ownership:** Google Chrome, stewarded with Microsoft Edge, Mozilla Firefox
  and MDN.
- **Licence:** **Apache-2.0** for code, **CC-BY-4.0** for `guides/` content; portions
  derived from MDN and specifications. Attribution is required for the content — an
  OmniCode install must carry it.
- **Dependencies:** an `npx` CLI that installs guides and fetches them at runtime
  (`search`, `retrieve`, `legacy-scan`).
- **Security:** telemetry on unless `DISABLE_TELEMETRY=1`; raw prompts are not
  collected per its documentation, but queries are. Runtime network fetches.
- **Maintenance:** active, eval-driven.
- **Compatibility:** skills + CLI rather than an OmniCode manifest; would need an adapter
  or a bundled snapshot with attribution.
- **Action:** decide between "fetch at runtime" and "vendor a snapshot with the CC-BY
  attribution"; both need the telemetry default surfaced.

### `cloudbase` (curated) — HOLD

- **Source / repository:** [TencentCloudBase/CloudBase-AI-Toolkit](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit)
  (verified); the catalog's `source` is a release zip
  (`…/releases/latest/download/cloudbase-omnicode.zip`) — a moving target with no pin,
  digest or signature in the entry.
- **Author / ownership:** Tencent Cloud (TencentCloudBase).
- **Licence:** **MIT**.
- **Dependencies:** npm package `@cloudbase/cloudbase-mcp` via `npx` launcher; remote MCP
  endpoints (`tcb-api.cloud.tencent.com`, `tcb-api.tencentcloud.com`), OAuth or static
  key-pair.
- **Security:** operates databases, functions, storage, hosting and deploys in the user's
  cloud account — the highest-privilege entry here. It requires its own environment and
  prompts before destructive operations, but OmniCode must enforce
  `permissions.mcpServers` and keep it out of auto-approve. Static credentials in a
  config file are a documented footgun; prefer the OAuth flow.
- **Maintenance:** active (v2.37.x releases).
- **Compatibility:** ships plugin variants for several harnesses; none is OmniCode's
  manifest. The zip URL being `latest` means the entry content is unpinned.
- **Action:** pin the zip by version and digest (or use the npm package with a pinned
  version), add an adapter manifest with `permissions.mcpServers`, then re-audit.

## Enforcement rules this audit establishes

1. **Separation:** `plugins/official/` is first-party only. Third-party entries stay
   catalog references (`source:` URL) and are never vendored into this repository without
   their licence file alongside.
2. **Permissions:** every executable surface (`hooks`, `commands`, `mcpServers`) must be
   declared, and the manifest parser rejects a plugin that uses one without declaring it —
   already implemented in `packages/engine/src/app/plugin/manifest.ts`.
3. **Unverifiable ⇒ HOLD:** a missing licence, a missing source, or an unpinned artifact
   blocks acceptance. `omnicode-webbridge` and `omnicode-telegram` are rejected as shipped
   for exactly this reason.
4. **Telemetry and privilege are install-time disclosures**, not footnotes: three of the
   four curated entries default telemetry on, and two ship far-reaching capabilities
   (MCP with write access, cloud backend control). The install surface must say so before
   a plugin is enabled.
