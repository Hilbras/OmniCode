# OmniCode Web App + Electron Plan

Status: planning complete, execution not started (2026-11-21)
Scope: turn `apps/omnicode-web` into the real OmniCode web client, styled in the
Hilbras design language with a modern app layout, over the existing daemon API —
then an Electron desktop shell that reuses the same web build untouched.

## Context

- The daemon already exists: `packages/server` serves REST (`/api/v1`, `/api/v2`)
  and a WS event protocol (`transport/ws/v1`) with loopback/bearer auth.
- `apps/omnicode-web` (React 19 + Vite + Tailwind 4) is a skeleton: `Shell.tsx`,
  `HomePage.tsx`, `SessionPage.tsx`, wired through `@hilbras/app-core`'s
  `DaemonOmnicodeWebApi` + `DaemonEventSocket`. It currently uses its own ad-hoc
  theme tokens (`--color-background`, `--highspeed-model-gradient`, …).
- The design source of truth is the Hilbras site
  (`/mnt/sda3/work/Hilbras/Hilbras`): a Tailwind 4 token family ("gold on
  ink"), Geist/Geist Mono, component classes (`btn-gold`, `card`, `eyebrow`,
  `mono-label`, …), and a reduced-motion-aware reveal system. The owner asked
  for **this design with a modern app layout** (an app, not the marketing page).
- Future: Electron desktop shell. Owner decisions on record: **D2** —
  `install-desktop` stays a pointer, no desktop source exists yet; **D3** —
  installers/distribution out of scope. Electron *source* is a new decision to
  confirm with the owner before Phase G; packaging/distribution stays gated.

## Non-negotiable laws

1. **Daemon-only data access.** The web app consumes `packages/server`'s API
   exclusively through `@hilbras/app-core` (transport, state machine,
   contracts). **Never import engine internals** — `apps/omnicode-vis` is the
   sanctioned read-only exception and it must not spread (AGENTS.md).
2. **`packages/client-contract` is a tripwire.** Any server/SDK addition this
   plan needs goes through the contract tables + generated artifacts
   (`gen:wire-contract`, `gen:api-reference`), never ad-hoc endpoints.
3. **Host-agnostic renderer.** No hardcoded host/port/origin, no filesystem
   assumptions in the renderer; credentials via `app-core`'s injected
   `CredentialStore`. This is what makes the Electron shell a wrapper, not a
   fork.
4. **Design is code.** Hilbras tokens are ported verbatim (same names, same
   values) into `apps/omnicode-web`; components are built on those tokens, not
   on one-off hex values.
5. **Guards stay green** after every phase: `pnpm check:guards`, `pnpm lint`,
   `pnpm --filter @hilbras/omnicode-web typecheck && test`, root Vitest graph.

## A. Design system port (foundation)

Source: `/mnt/sda3/work/Hilbras/Hilbras/src/app/globals.css` + `layout.tsx`.

| Token (same name = same value) | Light | Dark |
|---|---|---|
| `--bg` / `--bg-soft` | `#faf9f5` / `#f3f0e7` | `#0c0b09` / `#12100c` |
| `--surface` / `--surface-2` | `#ffffff` / `#f7f4ec` | `#15130e` / `#1b1812` |
| `--text` / `--muted` | `#17150f` / `#6f6857` | `#f2efe6` / `#9c9584` |
| `--line` / `--line-strong` | `#e7e1d1` / `#d8d0bb` | `#262117` / `#353021` |
| `--gold` / `--gold-bright` | `#d4af37` / `#e9c963` | `#e2bd52` / `#f3d789` |
| `--gold-text` / `--gold-ink` / `--gold-soft` / `--glow` | `#7d620f` / `#1c1704` / `rgba(212,175,55,.14)` / `rgba(212,175,55,.35)` | `#e6c768` / `#1a1503` / `rgba(226,189,82,.12)` / `rgba(226,189,82,.25)` |
| `--success` / `--danger` | `#0f5c38` / `#c23b31` | `#6fdb9b` / `#ff8a80` |

Also ported verbatim: the `@theme inline` mapping (incl. `--text-9/11/13/15`,
`--tracking-*`), the component classes (`btn-gold`, `btn-ghost`, `btn-quiet`,
`card`, `panel`, `eyebrow` + `eyebrow-dot`, `mono-label`, `section-title`,
`gold-text`, `hairline`, `nav-blur`, `node`, `theme-toggle`), the selection /
scrollbar / focus-visible treatments, and the reveal motion system gated on
`prefers-reduced-motion: no-preference` + `html.has-js`.

Fonts: Geist + Geist Mono self-hosted woff2 (`public/fonts/` in the Hilbras
repo) copied into `apps/omnicode-web/public/fonts/` with `@font-face` + local
`font-display: swap` (no Google Fonts dependency).

Theme: `data-theme="dark|light"` on `<html>`, pre-paint init script, storage
key `omnicode-theme` (app-owned; the site uses `hilbras-theme`). Default dark.

Deliverable: `apps/omnicode-web/src/styles/tokens.css` (tokens + component
classes) imported before Tailwind; `Shell` retargeted to these tokens; the old
ad-hoc `--color-*` variables deleted. A small `DesignTokens.test.tsx` asserts
token presence/parity for a fixed sample set.

## B. Modern app layout (the "modern layout" requirement)

App shell — three-region desktop layout, not a marketing page:

```
┌──────────────────────────────────────────────────────────────────────┐
│ topbar 48px: ◆ Omnicode · session title · mode/model pills · theme ⏾ │ nav-blur
├──────────────┬───────────────────────────────────────┬───────────────┤
│ sidebar 280px│ transcript pane (scroll)              │ drawer 320px  │
│  · New chat  │  messages, tool cards, streaming      │  (contextual: │
│  · sessions  │  ⏳/✔ status cards in gold-on-ink      │  files, tasks,│
│    (search,  │  eyebrow section labels               │  connectors,  │
│    pinned,   ├───────────────────────────────────────┤  memory)      │
│    project   │ composer: panel + textarea + send/steer│              │
│    grouping) │  [btn-gold send] [btn-ghost steer]     │              │
└──────────────┴───────────────────────────────────────┴───────────────┘
mobile ≤640px: sidebar collapses to a slide-over; drawer to a bottom sheet.
```

- Sidebar/topbar/composer keep the marketing components' DNA: `nav-blur`
  topbar, `panel` composer, `eyebrow` + `mono-label` for section labels,
  `hairline` separators, `node`-style hover cards for session rows.
- Status vocabulary: `StatusPill`-style pills for permission mode
  (`manual/auto/yolo`), connector states, turn state (`⏳ running`, `✔ done`,
  `✖ failed`).
- Motion: reuse the site's reveal system for panel transitions; **no** particle
  canvas in the app (marketing-only), keep `soft-pulse` for the "working"
  indicator.
- Accessibility: skip-link, `:focus-visible` gold outline (already in tokens),
  full keyboard navigation, aria-live for streaming deltas.

Components to build under `apps/omnicode-web/src/components/`:
`AppSidebar`, `Topbar`, `TranscriptView`, `MessageCard`, `ToolCallCard`,
`Composer`, `StatusPill`, `SessionRow`, `Drawer`, `ModeSelector`,
`ApprovalDialog`, `QuestionDialog`, `ThemeToggle`. Each with a component test.

## C. Daemon surface audit (what the UI consumes)

Already served by `packages/server/src/routes/` (verified):

| UI need | Daemon surface | Notes |
|---|---|---|
| Sessions list/open/create | `sessions.ts`, `registerApiV2Routes.ts` | cursor pagination exists in web `api/pagination.ts` |
| Transcript + streaming | `messages.ts`, `transcript.ts`, WS `sessionEventBroadcaster.ts` | `DaemonEventSocket` in `app-core` |
| Prompt / steer / stop | `prompts.ts`, `action-dispatch.ts` | |
| Approvals & questions | `approvals.ts`, `questions.ts` | mirror of the reverse-RPC flow |
| Permission mode, model, profile | `sessionAgentConfig.ts`, `sessionProfile.ts`, `modelCatalog.ts` | |
| Connectors (Telegram status) | `connectors.ts` | read + actions |
| Memory, skills, plugins | `memory.ts`, `skills.ts`, `plugins.ts` | drawer content |
| Files / media / export | `files.ts`, `fs.ts`, `workspaceFs.ts`, `sessionMedia.ts`, `sessionExport.ts`, `fileHistory.ts` | |
| Search, tasks, terminals | `search.ts`, `tasks.ts`, `terminals.ts` | later phases |
| Auth | `auth.ts`, `security/bindClassify.ts` | loopback/bearer discipline |

Gaps are filled by **extending the server + contract first** (law 2), never by
bypassing the daemon.

## D. Phases

Each item: own commit, component/unit tests, `check:guards` + lint + web
typecheck + web tests green; affected server/SDK changes get fail-on-base tests.

- **Phase A — foundation:** port tokens/fonts/motion (A), rebuild `Shell` into
  the three-region layout skeleton (B) with mock-free empty states; delete the
  old ad-hoc theme. Acceptance: shell renders both themes, responsive collapse
  works, no daemon calls yet.
- **Phase B — read path:** session list (`SessionRow`, search, grouping) +
  transcript view rendering assistant/tool/step entries from the daemon;
  WS-backed live append via `DaemonEventSocket`; markdown via `app-markdown`.
  Acceptance: opening a real session from a running daemon shows live updates.
- **Phase C — act:** composer (send/steer/stop), approvals & questions dialogs
  (reuse the interaction payloads), permission-mode `ModeSelector`, model
  switch. Server/contract gaps found here land as contract-first additions.
  Acceptance: a full turn driven from the browser, approval answered in web
  clears in CLI and vice versa (same kernel, already event-backed).
- **Phase D — manage:** connectors page (Telegram pairing/status — same data
  the TUI shows), memory drawer, files/workspace browser, session export.
- **Phase E — polish:** theme parity audit vs the Hilbras site, i18n via
  `app-i18n`, keyboard map, empty/error/loading states, responsive QA,
  performance pass (virtualized transcript for long sessions).
- **Phase F — hardening:** security review (token handling, no dangerous HTML
  in markdown rendering), `check:docs-claims`/`docs:check` updates, E2E against
  a scripted daemon fixture.

## E. Electron phase G (future, owner-gated)

- New `apps/omnicode-desktop`: Electron shell that loads the **built**
  `apps/omnicode-web` bundle and spawns `packages/server` as a loopback sidecar
  (bearer token via `CredentialStore`-equivalent injection); tray, native
  menu, `omnicode://` deep links, updater later.
- Requires owner sign-off on D2 (giving the pointer a real target) and D3
  (packaging/distribution) before any code lands.
- The renderer stays exactly the web build — no Electron-specific branches in
  app code except an injected platform adapter.

## Risks

- `app-core` has Vue-flavored peers for the vis app; React consumers must only
  use the transport/state parts (verified at Phase A kickoff).
- WS protocol coverage for approvals/questions must be confirmed in Phase C;
  if the v1 socket lacks them, extend `packages/server` + contract, not the
  client.
- Long-transcript performance: plan the virtualization in Phase E rather than
  pre-optimizing.

## Execution log

_Filled as phases land: commit hash, tests, gate output per item._

- **Decision (2026-11-21):** the old repo (`/mnt/sda3/work/Hilbras/OmniCode.old`)
  holds a mature Electron desktop shell (`apps/omnicode-desktop`: sidecar server
  spawn, window chrome, updater, telegram bridge, `.deb` releases) and a rich
  React vis frontend (`apps/omnicode-vis/web`, engine-internal data access).
  Owner choice: **build the new frontend and mine the old assets** — vis-web
  components get ported with their data calls adapted to the daemon API; the
  Electron shell gets ported for Phase G.
- **Phase A — foundation, landed.** `apps/omnicode-web`: Hilbras token family
  + component classes + Geist fonts ported (`src/styles/tokens.css`,
  `public/fonts/*.woff2`); ad-hoc zcode theme deleted; three-region
  `Shell.tsx` (nav-blur topbar, session rail slot, drawer slot, mobile
  slide-overs, skip link) with pre-paint theme init in `index.html`;
  `design/theme.ts` helpers; `SessionsRail`; `HomePage`/`SessionPage`
  restyled. Verified live in a browser: dark `#0c0b09` ↔ light `#faf9f5`
  toggle persisted, Geist loaded, regions present, daemon-error state renders.
  Tests 21/21 (design-token parity guard, theme helpers, route frames);
  `pnpm build` OK; `check:guards`, `lint` green.
- **Phase B — live read path, landed.** `src/api/sessionEvents.ts` (pure live
  turn reducer: assistantDelta accumulation, thinking indicator,
  sessionWorkChanged busy/idle with refetch flag), `hooks/useSessionEvents.ts`
  (one `connectEvents` connection per mounted session view, per-session
  subscribe, query invalidation on persisted-data events), `SessionPage`
  streams the in-flight assistant bubble and a thinking indicator. Tests 26/26
  (live projection reducer + routes + tokens + theme); `pnpm build` OK;
  `check:guards`, `lint` green.
