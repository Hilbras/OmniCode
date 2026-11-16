# OmniCode Mobile — UI-First Build Plan, informed by the Grok Android teardown

> **SUPERSEDED (2026-11-13):** direction changed — the app will be a
> **standalone native mobile app** (no dependency on this monorepo, no
> React/React Native; native Kotlin/Swift UI instead). The replacement plan
> lives in the new standalone project once scaffolded. This document remains
> as the Expo/React variant reference only. The Grok teardown evidence in
> section 1 is unchanged and still authoritative.

Companion analysis artifacts live in scratch space
(`.tmp/grok-analysis/` — extract digests, decoded resources, keyed strings,
`FINDINGS.md`); this document is the durable, self-contained summary.

## 1. Evidence base: Grok Android 1.2.56 teardown

Static analysis of `Grok_1.2.56-release.00_APKPure.xapk` (package
`ai.x.grok`, 44,336 classes, minSdk 32 / targetSdk 36) using REA with its
JADX and apktool providers. Facts below are observations from manifest,
class inventory, and decoded resources; no runtime observation of the real
UI succeeded (Play-integrity dialog on the emulator).

1. **Architecture: thin client.** A single-activity Jetpack Compose app
   renders a server-driven agent. The app's own Java/Kotlin namespace is a
   thin shell; the agent loop, tools, and cloud VM all run xAI-side.
2. **Transport: one WebSocket gateway** (`ai.x.grok.websocket.protocol.*`,
   ~99 event types, `wss://grok-v2.x.ai/ws/app_chat/stream_audio`) shaped
   like OpenAI Realtime: session create/update, conversation item CRUD and
   queue add/edit/move/interject, input chunks and audio buffers, streaming
   response deltas, function-call argument deltas, task events, image/video
   result events, rate-limit and presence events. Voice mode rides the same
   protocol in a separate `VoiceEngineService` process.
3. **Approvals are the core UX.** Every consequential tool action surfaces an
   inline card: headline ("Allow {bot} to run a command?"), request detail,
   caution line ("This shares your data outside this chat"), and Allow once /
   Always allow / Never, plus remembered Ask-first and auto-approve rules.
   MCP-server elicitation renders as native typed forms with field
   validation.
4. **Long-turn UX**: 28 playful activity status strings ("Running a few
   commands", "Writing some code") replace spinners while a turn runs;
   user messages can be queued, edited, and reordered mid-turn.
5. **Memory with review**: bot "Learnings" (memories, folder memory, team
   memory) require owner approve/reject before they take effect.
6. **UI system**: 100% Compose — zero XML layouts for app screens (the 554
   layout files all belong to bundled SDKs). Neutral palette: light
   `#f8f7f5`, dark `#0a0a0a`; Chirp font in five weights; 956 vector icons
   at 24dp, mixed filled/stroke; four Glance home-screen widgets.
   Accent colors and all screen geometry live in compiled Compose code —
   intentionally not extractable.
7. **Deliberately out of scope for us**: their cloud "Bot Computer", app
   publishing with custom domains, Cursor cloud-agent integration, phone-call
   agent (`InCallService`), assistant-service registration, four home-screen
   widgets, subscription/paywall stack, and the Braze/AppsFlyer/Intercom/Plaid
   SDK bundle.

## 2. What OmniCode Mobile adopts from this

| Grok pattern | OmniCode Mobile home |
|---|---|
| Thin client over an event stream | Event vocabulary for the mock agent in `src/lib/agent.ts`; UI consumes events, never the planner directly |
| Approval cards + remembered rules | Extend `src/components/ApprovalCard.tsx`; add per-tool tri-state rules to `src/lib/state.ts` |
| Activity status line during turns | New `ActivityStatus` component on the Hilbras status-pill style |
| Queued user messages | Reducer slice in `src/lib/state.ts` + queue chip row in `Composer.tsx` |
| Memory write review | Defer to the engine phase; UI reserves a review-card slot |
| Voice | Dictation only (Phase 5); realtime voice explicitly out of scope |

## 3. Stack decision: stay, and modernize in place

**Keep the installed stack.** It is the current-generation pairing, verified
against the [Expo SDK 58 docs](https://docs.expo.dev/versions/v58.0.0/)
(SDK 58 ↔ React Native 0.88 ↔ React 19.3 ↔ React Native Web 0.21, iOS 16.4+,
Android 7+): Expo SDK 58, Expo Router, React Native 0.88 (New Architecture is
the default — it has been since RN 0.76), Hermes, TypeScript ~6.0 in the
repo's strict mode, Vitest for pure logic, pnpm workspace.

**Add only two UI dependencies** (both Expo-Go compatible, installed with
`npx expo install` so versions stay SDK-matched):

1. `react-native-reanimated` (4.x line) — worklet-driven animations run on
   the UI thread. This upgrades the signature Hilbras elements
   (`ParticleField`, `AuroraGlow`, drawer/sheet transitions) from JS-thread
   `Animated` to frame-independent 60/120 Hz motion. Reanimated 4 requires
   the New Architecture we already target.
2. `@shopify/flash-list` (v2) — replaces the inverted `FlatList` chat list in
   `src/app/index.tsx` with better recycling and prefetch for long agent
   conversations.

**Rejected alternatives**: Flutter or a native (Swift/Kotlin) rewrite —
they would break the monorepo's shared TypeScript contracts with
`packages/engine`/`packages/SDK`, discard the working 3.5k-line UI phase and
the Hilbras token system, and buy no UX the New Architecture does not already
provide. Expo Router stays (routes only in `src/app/` per `AGENTS.md`).
Expo Go remains sufficient for this entire UI plan; nothing here needs a
custom dev build.

## 4. UI build order

Phase 0 is what already exists (verified on disk): chat screen with
responsive sidebar/drawer (`src/app/index.tsx`), composer, message items,
approval and tool-call cards, model sheet, sessions panel, snackbar with
undo, dark/light Hilbras palettes in `src/theme/tokens.ts`, seed data,
persistence, secure key storage, and vitest coverage for the planner and
reducer.

### Phase 1 — Motion and list foundation

- Add reanimated + flash-list via `npx expo install`.
- Port `ParticleField`, `AuroraGlow`, `TypingDots`, and drawer/sheet
  transitions to worklets; keep a single `motion.tsx` API so call sites do
  not change.
- Swap the chat `FlatList` for FlashList v2 (keep the `inverted` list and
  message memoization).
- Respect OS reduced-motion in the shared motion API.
- Acceptance: no JS-thread animation frames; list scroll stays smooth with a
  100+ message seeded session.

### Phase 2 — Event contract + chat surface completion

- Shape the mock agent as an explicit event stream (`session.created`,
  `conversation.item.added`, `response.text.delta`,
  `response.tool_call.requested`, `response.tool_call.completed`,
  `task.status.changed`, `error`) in `src/lib/agent.ts`, consumed by
  `useAgentRunner`. The engine swap later must not touch components.
- New `ActivityStatus` pill component cycling friendly status strings while
  `running` (Grok pattern 4).
- Queued messages: reducer actions + a queued-chip row above the composer
  (add/edit/remove/reorder before send).
- Markdown upgrade: Geist Mono code blocks with copy button and
  language-label hairline header; inline tool-result blocks.
- Streaming skeletons and typed error states (network, 401, rate limit) as
  message-system cards, not snackbars.

### Phase 3 — Approvals and tools

- Approval rules model in `src/lib/state.ts`: per tool an
  `ask-first | always | never` rule with "allow once" semantics, matching the
  repo invariant that approval gating lives outside the UI layer.
- Upgrade `ApprovalCard.tsx`: headline, request payload, caution line,
  Allow once / Always / Never, and a rules editor screen in `src/app/`.
- Upgrade `ToolCallCard.tsx` with collapsible argument/result payloads.

### Phase 4 — Sessions and navigation polish

- Session list: search, rename, pin; move duplicated drawer/panel logic into
  one `SessionsPanel` API.
- Empty state with curated prompt cards (already partly in `EmptyState.tsx`).
- Route-level transition polish via the Phase 1 motion API.

### Phase 5 — Onboarding, settings, dictation

- First-run flow: welcome → provider choice → key entry (secure store) →
  permission primers (notifications later; no mic primer until dictation
  ships).
- Settings: theme follows `ThemeProvider` (single owner per `AGENTS.md`),
  model defaults, data export/reset.
- Dictation via Expo AV/`expo-audio` record → provider transcription; the
  mic permission primer string pattern follows Grok's ("tap Settings >
  Permissions" fallback copy).

## 5. Performance playbook

- New Architecture + Hermes are defaults; do not opt out.
- JS thread is for state, not frames: continuous/physics-like animation only
  in worklets; `useNativeDriver` remains the floor for one-shot transitions.
- List discipline: FlashList + memoized rows; no `Math.random()` in render;
  stable `keyExtractor`.
- State: selector-style reads from the store context to avoid whole-tree
  re-renders on token-delta events.
- Images: `expo-image` when avatars/media arrive (caching, priority); never
  inline base64 into message state.
- Startup: keep `expo-splash-screen` handoff; defer particle field until
  after first paint on low-end Android.
- Measure before tuning: profile with React DevTools and the Android GPU
  HUD; no speculative memoization passes.

## 6. Deliberately not building

Home-screen widgets, share-target, realtime voice, assistant-service
registration, subscription/paywall surfaces, and analytics SDKs. Each needs
a custom dev build or adds bloat with no BYOK value. Revisit after the real
engine lands.

## 7. Validation

Per `apps/omnicode-mobile/AGENTS.md`, every phase ends with:

```bash
pnpm --filter @omnicode/mobile typecheck
pnpm --filter @omnicode/mobile test
pnpm --filter @omnicode/mobile lint
pnpm --filter @omnicode/mobile build   # web export stays green
```

Pure logic (planner, reducer, rules) keeps vitest coverage in `test/`
mirroring `src/lib`; reducer changes need a failing-test-first case per the
root review rules. Expo APIs are checked against
https://docs.expo.dev/versions/v58.0.0/ before use, never from memory.
