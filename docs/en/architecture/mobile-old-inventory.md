# `apps/omnicode-mobile.old` — inventory, preserved assets and terminal migration

Status: preserved in place. **Deletion is prohibited** until the terminal capability is
migrated into `apps/omnicode-mobile` and verified, or an explicit decision abandons it.
Only reproducible build output has been removed (details below). Nothing in the source
tree was touched.

## What it is

A Flutter (Dart 3.11 / Flutter ≥3.41) remote-control client for an OmniCode daemon —
the role `apps/omnicode-mobile` (Expo/React Native) plays today. Its README is explicit:
it is a client only, never runs the agent, has no local PTY, no SSH, no model call;
everything comes from the daemon over REST and WebSocket.

- **Source:** 23 files under `lib/` (~280 KB), one test file, an Android host project.
- **Tracking:** `git ls-files apps/omnicode-mobile.old` is empty — never committed.
- **State per its README:** analyzer clean, dependencies pinned in `pubspec.lock`, and
  **no real tests** ("compiles, not yet daemon-verified").

## Build output reclaimed (reproducible, deleted)

`build/` (955 MB), `.dart_tool/` (121 MB), `.idea/`, `android/.gradle/` (8.4 MB) and
`omnicode_mobile.iml` — 1.1 GB down to **1.2 MB**, all of it regenerable with
`flutter pub get && flutter build`. Preserved: `lib/`, `test/`, `pubspec.yaml`,
`pubspec.lock`, `analysis_options.yaml`, `assets/`, `android/` (minus Gradle caches),
`README.md`, `AGENTS.md`.

## Terminal over WebSocket — the one capability with no counterpart

`apps/omnicode-mobile` has no terminal or WebSocket code. This client does, and it is
small enough to port:

**Protocol** (`lib/src/ws/ws_protocol.dart`) — protocol version **2**, bearer token as a
WebSocket subprotocol `omnicode.bearer.<token>` (never a query parameter), 30 s heartbeat.
Client frames: `client_hello`, `subscribe_v2`/`unsubscribe_v2`, `abort`, `pong`, and the
terminal set `terminal_attach`, `terminal_detach`, `terminal_input`, `terminal_resize`,
`terminal_close`. Server frames: `server_hello`, `ack`, `ping`, `resync_required`,
`error`, `terminal_output`, `terminal_exit`. Resync reasons: `buffer_overflow`,
`session_recreated`, `epoch_changed`.

**Channel** (`lib/src/ws/terminal_channel.dart`) — `attach()` returns the daemon's
`replayed` frame count (the attach ack carries it, which is how the client can tell a
fresh attach from a resumed one), `reattach()` re-attaches after every handshake,
`detach()`, `sendInput(data)`, `resize({cols, rows})`, `close()`, `dispose()`. Output and
exit frames are filtered by `terminalId`, so several terminals can share one socket.

**Controller** (`lib/src/terminal/terminal_controller.dart`) — xterm 4.0 integration:
`attach()`, `reconnect()`, `closeTerminal()`, `onUserInput(data)`,
`updateLayout(maxWidth, maxHeight)` which derives the grid and sends
`terminal_resize`, plus `_onOutput`, `_onExit`, `_onConnectionState` and a status line.

**REST client** (`lib/src/api/*`), **connect/settings** (`connect_screen.dart`,
`server_config.dart`, `settings_store.dart` with `flutter_secure_storage`) and **design
tokens** (`omni_palette.dart`, `omni_theme.dart`) are secondary but useful cross-checks.

## Migration into the Expo app — evaluation

Feasible, and the Dart code is a specification rather than something to translate
line-for-line:

1. **Transport:** the Expo app opens one WebSocket with the bearer subprotocol and
   implements `client_hello` → `server_hello`, `subscribe_v2`, heartbeat and
   `resync_required` handling — the same frames the Flutter client uses. Server code
   already serves protocol v2; nothing daemon-side needs to change.
2. **Terminal surface:** `terminal_attach` → ack with `replayed`; stream
   `terminal_output`/`terminal_exit` filtered by `terminalId`; send `terminal_input`,
   `terminal_resize` (on layout change), `terminal_detach`, `terminal_close`. Reattach on
   reconnect, which is the one behaviour easy to get wrong and the Dart channel shows the
   shape.
3. **Rendering:** React Native has no DOM; a WebView-hosted xterm.js (the usual choice for
   RN terminals) or a native canvas renderer. The Flutter widget's layout maths
   (cols/rows from pixel size and font metrics) is the part worth reusing.
4. **Verification:** the port is done only when a real daemon session can attach, type,
   resize, be reattached after a socket drop, and close — exercised in the app, not only
   in unit tests. `docs/en/architecture/client-surfaces.md` is the contract the port must
   follow (daemon client, identity, secure credential storage).

Until that port lands and is verified, the Flutter directory stays as the reference
implementation. Deleting it earlier would delete the only working specification of the
terminal protocol from a client's point of view.

## Decision required (unchanged)

Deletion stays prohibited. If the terminal port is later abandoned by explicit decision,
the safe order is: keep `lib/src/ws/*` and `lib/src/terminal/*` as documentation, then
remove the directory. Nothing in the repository references it and no guard or test
depends on it.
