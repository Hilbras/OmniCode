# `apps/omnicode-mobile.old` — inventory and recovery assessment

Status: retired app, **untracked**, kept only until the owner decides. Nothing here has
been deleted. This note exists so the decision can be made from facts rather than from
the directory name.

## What it is

A Flutter (Dart 3.11 / Flutter ≥3.41) remote-control client for an OmniCode daemon —
the same role `apps/omnicode-mobile` (Expo/React Native) plays today. Its own README is
explicit: it is a client only, never runs the agent, has no local PTY, no SSH, no model
call; everything comes from the daemon over REST and WebSocket.

- **Source:** 24 files under `lib/` (280 KB), one test file, an Android host project
  (8.7 MB).
- **Bulk:** ~1.1 GB total — the rest is Flutter build output (`build/`, `.dart_tool/`,
  `android/.gradle`, `.idea/`), all reproducible from `pubspec.yaml`.
- **Tracking:** `git ls-files apps/omnicode-mobile.old` is empty; the directory is not in
  the repository's history at all.
- **State per its own README:** analyzer clean under strict casts/inference/raw types,
  dependencies resolved and pinned in `pubspec.lock`, and **no real tests** ("compiles,
  not yet daemon-verified").

## What is worth recovering

| Area | Files | Why it matters |
|---|---|---|
| Terminal over WebSocket | `lib/src/ws/{ws_protocol,ws_client,terminal_channel}.dart`, `lib/src/terminal/terminal_controller.dart` | A working xterm 4.0 integration that drives a live interactive PTY through the daemon. **The current Expo app has no terminal or WebSocket support at all** (no `terminal`/`WebSocket` reference under `apps/omnicode-mobile/src`), so this is the one capability with no replacement. |
| Daemon REST client | `lib/src/api/{api_client,envelope,sessions_api,chat_api,workspaces_api}.dart` | A second, independent reading of the daemon contract — useful as a cross-check when the client contract changes. |
| Connect + settings flow | `lib/src/ui/connect_screen.dart`, `lib/src/config/{server_config,settings_store}.dart` | Server URL pairing and secure-storage usage (`flutter_secure_storage`). |
| Design tokens | `lib/src/theme/{omni_palette,omni_theme,omni_widgets}.dart` | The palette/widget vocabulary; `appendices/`-free, self-contained. |
| Screens | `lib/src/ui/{sessions,chat,terminal,library,history}_screen.dart` | Interaction sketches for chat + terminal in one flow. |

What is **not** worth recovering: `build/`, `.dart_tool/`, `.idea/`, `android/.gradle`,
`omnicode_mobile.iml` — build output and editor state, reproducible and disposable.

## Recommendation

Do not delete yet. The terminal-over-WebSocket client is the only capability in this
directory that has no counterpart in the shipped Expo app, and porting it is a feature
decision, not a cleanup:

1. **Port the terminal channel** into `apps/omnicode-mobile` (Expo/React Native) using
   the Dart files above as the behavioural reference: protocol frames, controller state,
   reconnect handling. Then the Flutter directory has no unique content.
2. **Or** keep the Flutter app as a buildable reference and delete it only when a
   decision is made that mobile terminals are out of scope.

Either way, the ~1.1 GB of build output can be reclaimed immediately without touching
source or the tracked tree — that is a separate, safe cleanup if the owner wants it.

## Decision required

**Awaiting the owner's confirmation before any deletion.** If the answer is "delete",
the safe order is: reclaim build output first, keep `lib/`, `test/`, `pubspec.*`,
`README.md`, `AGENTS.md` and `android/app` until the terminal port lands (or until a
decision says it will not), and only then remove the directory. Nothing in this
repository references `apps/omnicode-mobile.old`, and no guard or test depends on it.
