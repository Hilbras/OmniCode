# omnicode-mobile — Agent Guide

Flutter remote-control client for the Omnicode daemon. Read `README.md` in this
folder before changing anything: it carries the setup steps, the unverified
dependency list, and the transcribed server contract.

## Role

Thin client. It talks to a running `packages/server` daemon over REST and
WebSocket and renders what the daemon reports.

Non-goals:

- never runs the agent, a model call, a local PTY, or SSH
- never owns session state; the daemon is the only source of truth
- is not part of the TypeScript build graph

## Hard rules

### 1. Write boundary

Everything this app changes lives under `apps/omnicode-mobile/`.

| Do not | Instead |
|---|---|
| import monorepo TS code | transcribe the contract into `lib/src/ws/ws_protocol.dart` and `lib/src/api/` |
| edit `pnpm-workspace.yaml`, root `tsconfig.json`, `vitest.config.ts`, `turbo.json`, root `package.json` | note the need in the change report |
| add a `package.json` here | keep the folder invisible to pnpm and Turbo |
| run `pnpm install` / `pnpm add` for this app | use `flutter pub get` inside this folder |
| hand-write `android/`, `ios/`, `linux/`, `web/` | run `flutter create . --platforms=…` |

The missing `package.json` is deliberate. `pnpm-workspace.yaml` globs `apps/*`,
but a directory without `package.json` is not a workspace package, so this app
does not affect `pnpm install`, Turbo, Vitest, or `pnpm check:workspace`.

### 2. Protocol constants have one home

Nothing else defines a wire string.

| Constant | Owner |
|---|---|
| `WS_PROTOCOL_VERSION` (`WsProtocol.protocolVersion = 2`) | `lib/src/ws/ws_protocol.dart` |
| `omnicode.bearer.` subprotocol prefix | `lib/src/ws/ws_protocol.dart` |
| every frame `type` string | `lib/src/ws/ws_protocol.dart` (`WsMessageType`) |
| `/api/v1`, `/api/v1/healthz`, `/api/v1/sessions`, `/api/v1/ws` | `lib/src/config/server_config.dart` (`ApiPaths`) |
| success/unauthorized/client-error codes | `lib/src/api/envelope.dart` (`ApiCodes`) |

Server error-code numbers (`SESSION_NOT_FOUND`, `TERMINAL_NOT_FOUND`,
`VALIDATION_FAILED`, `FS_PATH_ESCAPES_SESSION`) are never hardcoded. Surface
`code` and `msg` from the response.

### 3. Errors are one type and are never silent

`ApiFailure` (`lib/src/api/envelope.dart`) carries `code`, `message`, `fatal`,
`requestId`, `details`, `httpStatus`, and a `FailureSource` of `rest`, `ws`, or
`client`. REST failures, server `error` frames, decode failures, transport drops,
and ack rejections all become `ApiFailure` and reach the UI through
`AppState`. A `fatal` error stops auto-reconnect and must stay visible.

### 4. Terminal I/O is WebSocket only

There is no REST read or write endpoint for a terminal. Do not add one.
`terminal_input` carries a raw JSON string: control characters and UTF-8 pass
through, and nothing is base64-encoded.

### 5. Comments

Comment only non-obvious constraints: protocol ones (the ping/pong direction,
the `since_seq` resume rule, duplicate-seq dropping) and, in `lib/src/theme/`,
the CSS rule a literal value was derived from. No narration, no doc comments on
every member.

### 6. Design tokens have one home

`lib/src/theme/omni_palette.dart` transcribes
`/home/gin/work/Hilbras/OmniCloud/apps/web/src/index.css` — "gold on warm paper,
Geist + Geist Mono". **When a token changes there, change it here in the same
change.** Drift is silent: both apps still build and still look plausible, and
only a side-by-side comparison shows the difference.

| Rule | Detail |
|---|---|
| Never hardcode a colour in a screen or widget | Read it from `omniPaletteOf(context)`, or from `OmniTerminalTokens` inside the terminal viewport |
| Never invent a shade | Derive it from an existing token with an explicit alpha and name it in the palette |
| Never blend at runtime | Flutter has no `color-mix`; mixed values are precomputed literals in the palette |
| The terminal viewport is dark in both themes | `terminal_screen.dart` paints it from `OmniTerminalTokens`; only the chrome follows `themeMode` |
| No `fonts:` block without the binaries | A declared-but-missing family breaks the build. Family names live in `OmniFont`; the block to add is in `README.md` |

New components go in `lib/src/theme/omni_widgets.dart` and take their metrics
from `OmniRadius`, `OmniType`, and `OmniMotion`. Any motion must go through
`OmniMotion.interactionFor` / `entranceFor`, which honour
`MediaQuery.disableAnimations`.

## Contract source of truth

The daemon owns the contract. These files are authoritative; this client tracks
them.

| Server file | Defines |
|---|---|
| `packages/server/src/protocol/ws-control.ts` | WS control frames, acks, `server_hello`, `ping`, `resync_required`, `error`, protocol version |
| `packages/server/src/protocol/envelope.ts` | REST envelope, `code == 0` success, `request_id` |
| `packages/server/src/middleware/auth.ts` | Bearer auth, the bypass list, `40101 Unauthorized`, rate-limit bans |
| `packages/server/src/transport/ws/bearerProtocol.ts` | `omnicode.bearer.<token>` subprotocol, Host and Origin allowlists on upgrade |
| `packages/server/src/routes/terminals.ts` | terminal REST routes and terminal WS message handling |
| `packages/server/src/routes/sessions.ts` | session list/detail routes and pagination |

**When any of those changes, update this client's protocol constants and frame
models in the same change.** A drifted constant is a silent failure: the socket
opens, the handshake is rejected, and the UI only sees a reconnect loop. Check
`WsProtocol.protocolVersion` against `ws-control.ts` first.

## Layout

| Path | Role |
|---|---|
| `lib/main.dart` | Entry point, provider wiring, root screen gate. Keep it small. |
| `lib/src/config/server_config.dart` | `ServerConfig`, `ApiPaths`, URL and WS-URL derivation |
| `lib/src/config/settings_store.dart` | Base URL in `shared_preferences`, token in `flutter_secure_storage` |
| `lib/src/api/envelope.dart` | Envelope decode, `ApiFailure`, `ApiCodes`, defensive JSON readers |
| `lib/src/api/api_client.dart` | REST transport and error mapping |
| `lib/src/api/sessions_api.dart` | Session and terminal calls, `SessionRef`, `SessionPage`, `TerminalInfo`, `createSession` |
| `lib/src/api/chat_api.dart` | Message list and prompt submission, `ChatMessage`, `ChatApi`; the daemon lists newest-first, this file reverses to chat order and drops empty turn placeholders |
| `lib/src/api/workspaces_api.dart` | `GET /workspaces`, `WorkspaceRef` |
| `lib/src/ws/ws_protocol.dart` | Constants, frame models, encode/decode, payload builders |
| `lib/src/ws/ws_client.dart` | Socket lifecycle, handshake, ping/pong, ack correlation, reconnect, streams |
| `lib/src/ws/terminal_channel.dart` | Per-terminal attach/detach/input/resize/close and `since_seq` tracking |
| `lib/src/terminal/terminal_controller.dart` | Binds a channel to an `xterm` `Terminal`, derives `cols`/`rows` |
| `lib/src/state/app_state.dart` | `ChangeNotifier` for config, connection state, and the session list |
| `lib/src/theme/omni_palette.dart` | Light and dark design tokens, transcribed from OmniCloud `apps/web/src/index.css`; `OmniTerminalTokens` for the always-dark terminal |
| `lib/src/theme/omni_theme.dart` | `OmniTheme.lightTheme` / `darkTheme`, `OmniRadius`, `OmniType`, `OmniMotion`, `OmniFont`, `omniPaletteOf`, `OmniThemeController` |
| `lib/src/theme/omni_widgets.dart` | The component library the screens are built from |
| `lib/src/ui/connect_screen.dart` | Base URL and token entry, `healthz` probe, brand mark |
| `lib/src/ui/sidebar.dart` | Navigation drawer: brand, connection pill, `New chat`, `All sessions`, per-workspace session sections, theme toggle |
| `lib/src/ui/sessions_screen.dart` | Session list (filtered by the sidebar's selected workspace), terminals of one session, terminal creation |
| `lib/src/ui/chat_screen.dart` | Chat bubbles per role, tool-call chips, prompt composer, optimistic send with poll-driven refresh |
| `lib/src/ui/terminal_screen.dart` | `xterm` view, resize on layout change, reconnect and close actions |
| `test/icon_render_test.dart` | Generator: rasterizes `assets/icon.svg` into the launcher-icon PNGs; run after editing the SVG |

## Where new work goes

| Change | Home |
|---|---|
| New REST call | `lib/src/api/sessions_api.dart` (or a sibling `*_api.dart`) + path in `ApiPaths` |
| New WS frame | model and constants in `ws_protocol.dart`, dispatch in `ws_client.dart` |
| New per-session channel (messages, approvals, questions) | a sibling of `terminal_channel.dart` in `lib/src/ws/` |
| New screen state | `lib/src/state/app_state.dart`; keep widgets free of protocol logic |
| New screen | `lib/src/ui/`, reached from `sessions_screen.dart` or `main.dart` |
| New design token or reusable component | `lib/src/theme/`; keep `omni_palette.dart` in sync with OmniCloud `apps/web/src/index.css` |
| Theme mode switch or persistence | `OmniThemeController` in `lib/src/theme/omni_theme.dart`, rendered by `OmniThemeToggle` |

## Commands

All of these run inside this folder and need a Flutter toolchain, which is not
installed on every machine that touches this repo.

```bash
flutter create . --platforms=android   # once, to generate platform dirs
flutter pub get
flutter analyze
flutter test
flutter run
flutter build apk
```

Report the real result. If no toolchain is available, say so instead of claiming
the code is verified.

## Known traps

- `xterm` resolves at 4.0.0, which moved `onOutput` from `TerminalView` to
  `Terminal`. `OmniTerminalController` assigns `terminal.onOutput` in its
  constructor body so an injected `terminalOverride` is wired the same way.
- `xterm` also exports its own `TerminalController`. The app's class is
  `OmniTerminalController`; do not rename it back or the import goes ambiguous.
- `web_socket_channel` resolves at 3.0.3, where `WebSocketChannel.connect` takes
  no `headers`. `ws_client.dart` therefore connects with
  `IOWebSocketChannel.connect` from `package:web_socket_channel/io.dart`, which
  requires `dart:io`. A web target would have to authenticate with the
  `omnicode.bearer.<token>` subprotocol alone.
- `package:flutter/material.dart` is deprecated from Flutter 3.47 on, so this
  app imports `package:material_ui/material_ui.dart`. `xterm` still uses the
  legacy library, but only for `Colors` and widget-level types, so no
  `MaterialUiCompatibilityBridge` is needed around `TerminalView`.
- `OmniTerminalTokens.cursorAccent` has nothing to bind to: `xterm` 4.0.0's
  `TerminalTheme` has no cursor-accent field. Every other terminal token reaches
  the grid through `OmniTerminalTokens.xtermTheme`.
- Ack success is assumed to be `code == 0`, mirroring the REST envelope. If the
  daemon disagrees, `WsAck.isSuccess` is the one place to fix.
- Session summaries and session-event payloads are intentionally loosely typed.
  Do not promote a guessed field to a required one without reading the server
  route that produces it.
- Two runs can hit different daemons if the saved base URL is stale; the connect
  screen shows the stored URL and can forget it.
- `OmniTheme` also installs fallback `ButtonStyle`s for the Material buttons, but
  `ButtonStyle` cannot carry a `boxShadow`. A raw `ElevatedButton` therefore
  never looks like `GoldButton`; use the components in `omni_widgets.dart`.
- `OmniCard` fades in on first build. Inside a `ListView` that means it
  re-animates every time a row scrolls back into view, so list rows pass
  `animateEntrance: false`.
- The terminal viewport ignores `themeMode` on purpose. Reading
  `omniPaletteOf(context)` inside it still returns the app palette, because the
  dark `Theme` wrapper sits below the app bar; use `OmniTerminalTokens` there.
