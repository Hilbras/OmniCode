# OmniCode Mobile — Agent Guide

Expo SDK 58 / React Native 0.88 / React 19.3 app. On-device AI agent surface:
BYOK chat, tool calls, approval prompts. No OmniCode backend — the phone talks
straight to provider APIs (wiring lands after the UI phase; the agent loop is
currently a local mock in `src/lib/agent.ts`). `README.md` states plainly which
parts are real and which are mocked, and the About block in
`src/app/settings.tsx` labels the app `ON-DEVICE AGENT · PREVIEW` so the same is
true inside the app; keep those three in step when the loop becomes real.

Part of the pnpm workspace (`@omnicode/mobile`). Install from the repo root
with `pnpm install`; never run `npm install` inside this directory.

## Design system — Hilbras, not generic

Visual language is copied from the Hilbras company site
(`/home/gin/work/Hilbras/Hilbras`, `src/app/globals.css`). Do not invent a
parallel palette.

- Tokens live in `src/theme/tokens.ts`: gold-on-warm-neutral, dark default,
  light variant, exact hex values from the site.
- Type: Geist + Geist Mono via `@expo-google-fonts`. Micro-labels are mono,
  uppercase, wide tracking; headings tight negative tracking.
- Icons: `lucide-react-native`, strokeWidth 1.4–1.6.
- Brand marks: `src/components/BrandMark.tsx` ports the OmniCode face and the
  Hilbras hexagon-H from `Hilbras/public/logos/omnicode.svg` and
  `public/favicon.svg`. Raster assets in `assets/` are generated from
  `assets/brand/*.svg` with `sharp-cli`; regenerate, never hand-edit.
- Signature elements: aurora gold glow, particle constellation, hairline gold
  dividers, gradient gold buttons with glow, status pills, 16px card radii.

## Structure

```text
src/app/          expo-router screens (_layout, index chat, settings)
src/components/   UI components (no routes here)
src/hooks/        useAgentRunner — drives the mock agent into the store
src/lib/          pure logic: types, state reducer, agent planner, providers,
                  seed data, secure key storage, persistence
src/theme/        tokens, typography, ThemeProvider
test/             vitest unit tests for pure logic (mirrors src/lib)
```

State: single reducer in `src/lib/state.ts`, context in `src/lib/store.tsx`,
persisted to AsyncStorage (`omnicode-state-v1`). Theme is owned solely by
`ThemeProvider` (`hilbras-theme` key) — do not duplicate it in settings state.
API keys: `expo-secure-store` on native, AsyncStorage fallback on web, via
`src/lib/secure.ts`.

## Commands

```bash
pnpm --filter @omnicode/mobile dev        # expo start
pnpm --filter @omnicode/mobile typecheck
pnpm --filter @omnicode/mobile test
pnpm --filter @omnicode/mobile lint
pnpm --filter @omnicode/mobile build      # expo export --platform web
```

Metro is configured for the pnpm monorepo (`metro.config.js`: watchFolders +
nodeModulesPaths + disableHierarchicalLookup). Do not remove that config.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that
touches an Expo, EAS, or React Native API:

1. Read the major version of `expo` in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. Otherwise fetch https://docs.expo.dev/llms.txt and follow its links.

Use `npx expo install <package>` (never raw npm/pnpm add) so versions stay
SDK-compatible. Run lint and typecheck before declaring a task done.

## Rules

- Expo Router for navigation; routes only in `src/app/`.
- `ios/` and `android/` are generated (CNG). Never create or edit them by
  hand; configure native behavior in `app.json` and config plugins.
- Expo Go only bundles its own native modules. Added native code needs a
  development build (`npx expo run:ios|android` or EAS).
- Keep the agent planner and reducer pure (no React Native imports) so
  vitest covers them in node.
- Approval-gated tools must stay approval-gated when the real engine lands.
- Memory writes stay `unverified`; keys never appear in logs or telemetry.
