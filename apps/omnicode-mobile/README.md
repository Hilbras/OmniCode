# OmniCode mobile — preview

An Expo/React Native app for on-device sessions. It is a **preview**: the UI, the
store and the design system are real, and the agent loop that answers you is not.

## What is a preview

- `src/lib/agent.ts` is a **local mock**. `planTurn` returns canned prose and
  hand-written steps; nothing is sent to a model provider and no answer is
  generated from your input.
- `src/lib/providers.ts` is provider and model *metadata* for the pickers. The
  API-key screen stores a key (`src/lib/secure.ts`), but no request is made with
  it yet.

## What works

- Chat UI, sessions list, message state and attachments (`src/lib/state.ts`,
  `src/lib/store.tsx`, `src/components/`).
- The Hilbras design system and theming (`src/theme/`).
- Settings: provider/model selection, key entry, session clearing.

The About block in Settings says `ON-DEVICE AGENT · PREVIEW` so the app states
this itself rather than only in this file.

## Working on it

```bash
pnpm --filter @omnicode/mobile typecheck
pnpm --filter @omnicode/mobile test
pnpm --filter @omnicode/mobile start
```

`AGENTS.md` in this directory carries the layout, the design rules and the
conventions for new screens; read it before adding one.
