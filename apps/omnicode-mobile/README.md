# omnicode-mobile

Flutter remote-control client for an Omnicode daemon.

**This app is a client only. It never runs the agent.** There is no local PTY,
no SSH, no model call, no session state of its own. Everything it shows comes
from a running `packages/server` daemon over REST and WebSocket, and every
action it takes is a message to that daemon. If the daemon stops, this app is a
blank screen.

Phase 1 scope: connect to a daemon, list sessions, pick one, list or create its
terminals, attach to a terminal, and drive a live interactive PTY over
WebSocket. Later phases add full agent session control (send prompts, answer
approvals and questions, replay transcripts).

## Status: compiles, not yet daemon-verified

Read this before trusting anything below.

- **The analyzer is clean.** `flutter analyze` reports no issues against the
  resolved versions below, with `strict-casts`, `strict-inference`, and
  `strict-raw-types` on top of `package:flutter_lints/flutter.yaml`. There are
  still **no tests** — nothing here is unit-tested, widget-tested, or run.
- **Dependencies are resolved, not guessed.** `flutter pub get` has run and
  `pubspec.lock` pins the real versions. See "Resolved dependencies" below.
- **The `xterm` API is now compile-checked against 4.0.0**, which differs from
  the 3.x shape this code was first written for: `onOutput` moved from
  `TerminalView` to `Terminal`, and `xterm` exports its own `TerminalController`
  (hence this app's `OmniTerminalController`). `Terminal(maxLines: ...)`,
  `terminal.write(...)`, and `TerminalView(terminal, ...)` are unchanged.
- **`web_socket_channel` is used via `IOWebSocketChannel.connect(uri, headers:, protocols:)`
  and `channel.ready`.** 3.x's `WebSocketChannel.connect` accepts no `headers`,
  so the Bearer header needs the `dart:io` implementation. That rules out a web
  target unless the client falls back to subprotocol-only auth.
- **`package:flutter/material.dart` is deprecated from Flutter 3.47 on**, so
  every UI file imports `package:material_ui/material_ui.dart` instead.
- **`flutter_secure_storage` is used with its default constructor and
  `read`/`write`/`delete(key:)`.** No platform-specific options
  (`AndroidOptions`, `IOSOptions`) are configured. On Android the default
  backing store may not be `EncryptedSharedPreferences`; revisit that when the
  app is first run on a device.
- **Platform directories are generated, not hand-written.** `android/` came from
  `flutter create . --platforms=android`. `ios/`, `linux/`, and `web/` are still
  absent.
- **Nothing was verified against a live daemon.** The contract in this file was
  transcribed from the server source, not from an observed exchange.
- **The design system has never been rendered next to the web app.** The theme
  layer in `lib/src/theme/` and the three restyled screens compile, but no
  side-by-side comparison against OmniCloud `apps/web` has been made.

## Setup

These steps must be run by you, in order, on a machine with the Flutter
toolchain installed.

1. Install Flutter and the Android SDK, then confirm both:

   ```bash
   flutter --version
   flutter doctor --android-licenses
   ```

   `flutter doctor` must report a usable Android toolchain (or an iOS toolchain
   if you target a simulator).

2. From inside this folder, generate any missing platform directories:

   ```bash
   cd apps/omnicode-mobile
   flutter create . --platforms=android
   ```

   `android/` already exists in this tree, so this step is a no-op unless you
   add a platform. `flutter create .` on an existing project fills in only what
   is missing and **preserves `lib/` and `pubspec.yaml`**. Add more platforms
   with the same command, e.g. `flutter create . --platforms=ios,android`.

3. Resolve dependencies:

   ```bash
   flutter pub get
   ```

   Already run for this tree; the resolutions are in `pubspec.lock`. See
   "Resolved dependencies".

4. Reconcile the SDK constraint. `pubspec.yaml` declares `sdk: ^3.11.0` and
   `flutter: ">=3.41.0"`, resolved against Dart 3.14.0 / Flutter 3.50.0.
   `material_ui` needs Dart `^3.13.0` and Flutter `>=3.47.0`, which is the real
   floor now. If your installed Flutter is older, `pub get` will say so — edit
   the `environment` ranges to match your local SDK rather than downgrading the
   toolchain.

5. Run it:

   ```bash
   flutter run                  # attached device or emulator
   flutter build apk            # release artifact
   ```

6. Check it:

   ```bash
   flutter analyze
   flutter test
   ```

   `flutter analyze` is clean and must stay that way. `analysis_options.yaml`
   enables `strict-casts`, `strict-inference`, and `strict-raw-types` on top of
   `package:flutter_lints/flutter.yaml`. There are no tests in this tree yet, so
   `flutter test` runs nothing.

## Resolved dependencies

`flutter pub get` has run against Flutter 3.50.0 / Dart 3.14.0, so these are the
real resolutions, not guesses. `pubspec.lock` is authoritative.

| Package | Constraint | Resolved | Notes |
|---|---|---|---|
| `flutter` | sdk | 3.50.0 | From the resolved Flutter SDK. |
| `material_ui` | `^1.11.0` | 1.11.0 | Replaces `package:flutter/material.dart`, which Flutter deprecated after v3.47.0-0.0.pre. Exports the same widget surface plus `package:flutter/widgets.dart`, so the migration is an import swap. Pulls in `cupertino_ui`, `intl`, and `flutter_localizations`. |
| `http` | `^1.6.0` | 1.6.0 | Uses `http.Request`, `Client.send`, `Response.fromStream`. `Response.reasonPhrase` is `String?` — HTTP/2 has no reason phrase. |
| `provider` | `^6.1.5` | 6.1.5+1 | Uses `ChangeNotifierProvider.value`, `context.watch`, `context.read`, `context.select`. |
| `shared_preferences` | `^2.5.6` | 2.5.6 | Uses `getInstance`, `getString`, `setString`, `remove`. |
| `web_socket_channel` | `^3.0.3` | 3.0.3 | `WebSocketChannel.connect` takes no `headers` in 3.x, so `ws_client.dart` uses `IOWebSocketChannel.connect` from `package:web_socket_channel/io.dart`. `channel.ready` needs 2.2.0+. |
| `xterm` | `^4.0.0` | 4.0.0 | `onOutput` lives on `Terminal`, not `TerminalView`. `TerminalTheme` has 23 required parameters and no `copyWith`, so `OmniTerminalTokens.xtermTheme` spells all of them out. Also exports its own `TerminalController`. |
| `flutter_secure_storage` | `^11.0.0` | 11.2.0 | Used only through the default constructor and `read`/`write`/`delete`. |
| `flutter_svg` | `^2.3.4` | 2.3.4 | Renders `assets/icon.svg` on the connect screen via `SvgPicture.asset(name, width:, height:, fit:, semanticsLabel:)`. |
| `flutter_lints` | `^6.0.0` | 6.0.0 | Dev only. |
| `flutter_test` | sdk | — | Dev only. No tests exist yet. |

If `pub get` reports a conflict, resolve it by narrowing the ranges to the
majors that pub actually offers, not by adding `dependency_overrides`.

## Design system

"Gold on warm paper, Geist + Geist Mono", ported from the OmniCloud web app.
The stylesheet that owns these values is
`/home/gin/work/Hilbras/OmniCloud/apps/web/src/index.css`. **That file is the
source of truth; `lib/src/theme/omni_palette.dart` is a transcription of it.**
If a token changes there, change it here in the same commit — a drifted token is
invisible until someone puts the two apps side by side.

| File | Role |
|---|---|
| `lib/src/theme/omni_palette.dart` | Light and dark token structs, plus `OmniTerminalTokens` |
| `lib/src/theme/omni_theme.dart` | `ThemeData` for both brightnesses, radii, type scale, motion, font-family constants, `omniPaletteOf(context)`, `OmniThemeController` |
| `lib/src/theme/omni_widgets.dart` | `GoldButton`, `GhostButton`, `SecondaryButton`, `DangerButton`, `OmniCard`, `OmniInput`, `OmniNotice`, `OmniStatusPill`, `OmniAppBar`, `OmniThemeToggle`, `OmniBrandMark`, `OmniDialog`, `OmniFocusRing` |

### Theme mode

`ThemeMode.system` by default, so the app follows the OS. Every app bar carries
an `OmniThemeToggle` that cycles system → light → dark, mirroring the web app's
theme toggle. The choice is persisted in `shared_preferences` under
`omnicode.ui.themeMode`; a read or write failure is swallowed and the app simply
stays on the system setting. `main.dart` loads it before `runApp`, so there is no
flash of the wrong theme.

**The terminal viewport is always dark.** A terminal that follows a light app
theme is unreadable and unlike any real terminal, so `terminal_screen.dart`
paints the viewport background from `OmniTerminalTokens` (the dark tokens) and
wraps it in `Theme(data: OmniTheme.darkTheme)` regardless of `themeMode`. The
chrome around it — app bar, status strip, menus, dialogs — follows the app theme.
`OmniTerminalTokens` also carries `cursor` (dark gold `#e2bd52`),
`cursorAccent`, `foreground`, `selection`, and `muted` for the `xterm` grid; see
"Known gaps" for why they are not wired in yet.

### Component mapping

| CSS | Flutter |
|---|---|
| `.btn-gold` | `GoldButton` → `OmniButton(variant: gold)`. Radius 10, padding 9/18, 14px w600, `gold` fill, `gold-ink` text, 1px `goldBorderMix` border, `goldButtonShadow`. Hover/press: `gold-bright` + `goldButtonShadowHover` + 1px lift; press adds `scale(0.98)`; disabled `Opacity(0.65)`. |
| `.btn-ghost` | `GhostButton`. Radius 10, padding 9/18, 14px w500, `surface` fill, `line-strong` border. Hover: `gold` border, `gold-soft` fill, 1px lift. Disabled 0.6 (not specified in the stylesheet; borrowed from the other non-primary buttons). |
| `.btn-secondary` | `SecondaryButton`. Radius 8, padding 8/14, 14px w500. Hover: border `goldBorderHover` (gold @40%), text `gold-text`. Disabled 0.6. |
| `.btn-danger` | `DangerButton`. Radius 8, padding 8/14, 14px w600, transparent fill, `dangerBorder` (bad @70%), `bad` text. Hover: `dangerHoverBackground` (bad @10%). Disabled 0.6. |
| `.input` | `OmniInput`. Radius 10, padding 11/14, 14.5px, `surface` fill, `line-strong` border, `placeholderText` (muted @70%) hint. Focus: `gold` border plus a 3px `gold-soft` ring painted outside the field. Invalid: `bad` border. Field errors render at 12.5px in `bad`. |
| `.notice` / `.notice-error` | `OmniNotice(variant: info | error)`. Radius 10, padding 11/14, 13px with 1.5 line height, `text` body colour. Info: `gold-soft` fill, gold @45% border. Error: bad @10% fill, bad @45% border. |
| `.card` | `OmniCard`. Radius 16, `surface` fill, 1px `line` border, the `shadow` token. Entrance: 220ms fade from `translateY(8px) scale(0.985)`. Pass `animateEntrance: false` for list rows, which are rebuilt while scrolling and would re-animate on every pass. `OmniRadius.panel` (18) is available for large surfaces; `OmniDialog` uses it with `shadowRaised`. |
| `.nav-blur` | `OmniAppBar`. Background `appBarBackground` (bg @94%), 1px bottom hairline in `appBarBorder` (line @78%), no elevation, `surfaceTintColor: transparent`. |
| `:focus-visible` | `OmniFocusRing`: a 2px `gold` ring painted 2px outside the widget, driven by `InkWell.onFocusChange` for buttons and by the field's `FocusNode` for inputs. |

Motion is `OmniMotion.interaction` (140ms) and `OmniMotion.entrance` (220ms) on
`OmniMotion.ease`, which is `Cubic(0.22, 1, 0.36, 1)` — the stylesheet's
`cubic-bezier(0.22, 1, 0.36, 1)` maps onto `Cubic` directly.
`OmniMotion.isReduced(context)` reads `MediaQuery.disableAnimations` (and
`accessibleNavigation`); when it is true, lifts, press scaling, and entrance
animations are disabled and the durations collapse to zero.

### Where Flutter could not express the CSS

Recorded so nobody re-derives them and gets a different answer.

- **`color-mix()` does not exist.** Every mixed token is precomputed as a
  literal in `omni_palette.dart`: `goldBorderMix` is `color-mix(gold 72%, #000
  28%)` → `#997E28` light / `#A3883B` dark. Every `rgba()`/alpha mix is written
  as `Color.fromRGBO(...)` with the CSS alpha, so the mapping stays readable.
- **`box-shadow` lists** map to `List<BoxShadow>`, which Flutter does support, so
  both layers of the `shadow` token are kept rather than flattened to one.
- **Blur radius is halved.** CSS states the full extent of the blur while
  `BoxShadow.blurRadius` behaves like a sigma, so `0 8px 28px` becomes
  `offset: Offset(0, 8), blurRadius: 14`. If the shadows read too tight, change
  the `shadow` / `shadowRaised` / `goldButtonShadow*` tokens only.
- **No backdrop blur.** `.nav-blur` is a translucent bar over a blurred page;
  `OmniAppBar` keeps the 94% background but drops the blur, because a
  `BackdropFilter` behind an app bar costs a full-screen saveLayer on every
  frame for an effect that is invisible over a flat `bg`.
- **`outline-offset` has no widget.** `OmniFocusRing` paints the offset ring with
  a `CustomPainter` on `foregroundPainter`, which draws outside the widget box.
  Nothing reserves that 4px, so a ring on a widget flush against a clipping
  ancestor can be cropped at the very edge.
- **Hover is desktop-only.** The hover states and the 1px lift are implemented
  and fire under a mouse or trackpad; on touch, press states carry the feedback.
- **Tap targets.** The buttons are exactly as tall as the CSS padding makes them
  (~32dp), which is below Android's 48dp guidance. Fidelity to the token sheet
  won; raise `OmniType.button` or the vertical padding in `OmniButton._padding`
  if that becomes a problem in practice.

### Fonts

The design system uses **Geist** and **Geist Mono**. The binaries are not in this
repository and were not downloaded, so `pubspec.yaml` deliberately has **no
`fonts:` block** — declaring a family whose files are missing breaks the build.
The app renders in Flutter's default face, and the family names are parked as
constants in `OmniFont` (`sans = 'Geist'`, `mono = 'Geist Mono'`).

To switch them on: drop the files into `assets/fonts/`, add this block to
`pubspec.yaml` under `flutter:` (keeping `uses-material-design: true`), then set
`OmniFont.activeSans = sans` and `OmniFont.activeMono = mono`:

```yaml
  fonts:
    - family: Geist
      fonts:
        - asset: assets/fonts/Geist-Regular.ttf
          weight: 400
        - asset: assets/fonts/Geist-Medium.ttf
          weight: 500
        - asset: assets/fonts/Geist-SemiBold.ttf
          weight: 600
        - asset: assets/fonts/Geist-Bold.ttf
          weight: 700
    - family: Geist Mono
      fonts:
        - asset: assets/fonts/GeistMono-Regular.ttf
          weight: 400
        - asset: assets/fonts/GeistMono-Medium.ttf
          weight: 500
        - asset: assets/fonts/GeistMono-SemiBold.ttf
          weight: 600
```

Rename the `asset:` paths to whatever the real files are called. Weights 500 and
600 matter: the design system uses 500 for ghost/secondary buttons and 600 for
gold/danger buttons, and without those faces both fall back to a synthesised or
nearest-match weight.

### App icon and launcher icons

`assets/icon.svg` is a copy of `/home/gin/work/Hilbras/OmniCode-V/public/icon.svg`
(1024×1024: dark warm tile `#1b160e`→`#0d0b08` with `rx=216`, a
`rgba(255,240,210,0.08)` inner stroke, a `#e5b94a` radial glow, and a gold face
`#f2cb63`→`#d9a83a` masked by two rounded eye slits). It is registered under
`flutter: assets:` and rendered by `OmniBrandMark` on the connect screen.

**Launcher icons are not generated.** Android launcher icons are mipmaps under
`android/app/src/main/res/`, which currently holds the stock `flutter create`
artwork. Use `flutter_launcher_icons` with `assets/icon.svg` (or a 1024×1024 PNG
export of it, which is the safer input) as the source:

```yaml
dev_dependencies:
  flutter_launcher_icons: ">=0.13.0 <1.0.0"

flutter_launcher_icons:
  android: true
  ios: true
  image_path: "assets/icon.png"
  adaptive_icon_background: "#0d0b08"
  adaptive_icon_foreground: "assets/icon.png"
```

Then `dart run flutter_launcher_icons`. The version constraint above is
unverified for the same reason as the rest of the dependency table. Nothing in
this repository ran it.

## Server contract

Authoritative source: the daemon in `packages/server`. This section is a
transcription for readers who do not want to re-derive it. `AGENTS.md` lists the
exact files that own each part.

### REST

Base path `/api/v1`. Every JSON response uses one envelope:

```jsonc
{
  "code": 0,            // 0 == success
  "msg": "success",
  "data": { },          // T | null
  "request_id": "…",
  "details": null,      // optional
  "stack": "…"          // optional
}
```

Non-zero `code` is an application error. The HTTP status can also be non-2xx
(401 unauthorized, 403 forbidden, 429 rate-limit ban), and the two are
independent: this client fails a call if `code != 0` **or** `status >= 400`.

Auth: `Authorization: Bearer <token>` on every `/api/*` request. Auth is
bypassed for `OPTIONS`, for `GET /api/v1/healthz`, and for any path that does
not start with `/api/`. An auth failure is HTTP 401 with `code: 40101` and
`msg: "Unauthorized"`.

Endpoints used in phase 1:

| Method and path | Purpose |
|---|---|
| `GET /api/v1/healthz` | Connectivity probe. No auth needed. |
| `GET /api/v1/sessions` | List sessions. Query: `before_id`, `after_id`, `page_size`. `data` is a page object. |
| `GET /api/v1/sessions/{session_id}` | Session detail. |
| `GET /api/v1/sessions/{session_id}/terminals` | `data` is `{ items: Terminal[] }`. |
| `POST /api/v1/sessions/{session_id}/terminals` | Create. Body may carry `runtime_id` (string, optional; the server defaults it to `"local"`). `data` is the created Terminal. |
| `GET /api/v1/sessions/{session_id}/terminals/{terminal_id}` | One terminal. |
| `POST /api/v1/sessions/{session_id}/terminals/{terminal_id}/close` | Close. `data` is `{ closed: true }`. |

**There is no REST endpoint for terminal input or output.** All terminal I/O is
WebSocket.

Terminal-route error names seen server-side: `SESSION_NOT_FOUND`,
`TERMINAL_NOT_FOUND`, `VALIDATION_FAILED`, `FS_PATH_ESCAPES_SESSION`. These are
numeric codes defined in the daemon; the numbers are deliberately **not**
hardcoded in this client. `code` and `msg` are surfaced to the user generically.

Also present on the daemon and **not** implemented here yet: messages, approvals,
questions, transcript, snapshot, tasks, tools, config, workspaces, files, search,
and an OAuth device-code flow (start/poll/cancel). Machine-readable specs are
served at `GET /openapi.json` and `GET /asyncapi.json` — both are auth-gated.

### WebSocket

Path `/api/v1/ws`. Protocol version **2**.

Auth on the upgrade request, two accepted forms:

1. `Authorization: Bearer <token>` header.
2. Subprotocol `Sec-WebSocket-Protocol: omnicode.bearer.<token>` — the prefix is
   exactly `omnicode.bearer.` and the server selects that subprotocol back.

This client sends **both** when a token is configured: the header first because
it is the cleanest form, and the subprotocol because it is the portable path.
The server also enforces a Host allowlist and an Origin allowlist on upgrade;
those failures return HTTP 403 before the socket opens. Bad credentials return
401 and a rate-limit ban returns 429.

Client → server control frames are `{ type, id, payload }`; the server answers
with `{ type: "ack", id, code, msg, payload }` correlated by `id`.

| type | payload | ack payload |
|---|---|---|
| `client_hello` | `{ client_id, subscriptions?, cursors?, agent_filter? }` | `{ accepted_subscriptions, resync_required, cursors? }` |
| `subscribe` | `{ session_ids, cursors?, agent_filter? }` | `{ accepted, not_found, resync_required, cursors? }` |
| `subscribe_v2` | `{ session_id, transcript, transcript_since? }` | same as `subscribe` |
| `unsubscribe` | `{ session_ids }` | same as `subscribe` |
| `unsubscribe_v2` | `{ session_id, agent_ids? }` | same as `subscribe` |
| `abort` | `{ session_id, prompt_id }` | `{ aborted?, at_seq? }` |
| `terminal_attach` | `{ session_id, terminal_id, since_seq? }` | `{ attached: true, replayed }` |
| `terminal_detach` | `{ session_id, terminal_id }` | `{ detached: true }` |
| `terminal_input` | `{ session_id, terminal_id, data }` | `{ accepted: true }` |
| `terminal_resize` | `{ session_id, terminal_id, cols > 0, rows > 0 }` | `{ resized: true }` |
| `terminal_close` | `{ session_id, terminal_id }` | `{ closed: true }` |
| `pong` | `{ nonce }` | none |

Server → client system frames:

- `server_hello` — first frame after the socket opens:
  `{ ws_connection_id, protocol_version, heartbeat_ms?, max_event_buffer_size,
  capabilities: { event_batching, compression } }`.
- `ping` — `{ nonce }`. **The server pings and the client pongs**; the client
  never initiates a ping.
- `resync_required` — `{ session_id, reason, current_seq, epoch? }` where
  `reason` is `buffer_overflow`, `session_recreated`, or `epoch_changed`. Local
  state must be rebuilt from REST history.
- `error` — `{ code, msg, fatal, request_id?, details? }`. `fatal` is honoured:
  a fatal error stops auto-reconnect.

Server → client terminal stream frames:

- `terminal_output` — `{ seq > 0, session_id, terminal_id, timestamp,
  payload: { data } }`. `data` is a raw string; control characters and UTF-8
  pass through as JSON string content. Nothing is base64-encoded.
- `terminal_exit` — `{ session_id, terminal_id, timestamp,
  payload: { exit_code: int | null } }`.

Server → client session events: the frame `type` is the underlying event type
name (not the literal `session_event`), and the envelope is
`{ type, seq >= 0, epoch?, volatile?, offset?, session_id?, timestamp, payload }`.
Phase 1 only needs to not crash on these: they are decoded into a loosely typed
`WsSessionEventFrame` and exposed as a raw broadcast stream.

Handshake order: socket opens → server sends `server_hello` → client sends
`client_hello` with a stable `client_id` → client awaits its ack → then
subscribe/attach as needed.

`heartbeat_ms` from `server_hello` drives a liveness timer: the connection is
treated as dead if no frame of any kind arrives within `heartbeat_ms * 3`.

### Assumptions this client makes

Recorded here because none of them could be checked against a running daemon.

- **Ack success is `code == 0`.** The REST envelope documents `code == 0` with
  `msg == "success"`; the ack frame reuses the same `code`/`msg` pair, so the
  same rule is applied. If the daemon acks with something else (for example
  200), `WsAck.isSuccess` in `lib/src/ws/ws_protocol.dart` is the single place
  to change.
- **Session and terminal ids are read from `id`, falling back to `session_id` /
  `terminal_id` / camelCase variants.** The page object's item array is looked up
  under `items`, then `sessions`, `terminals`, `data`, `results`, `list`, and a
  bare array is also accepted. Everything else in a session summary or terminal
  object is kept as a raw `Map<String, Object?>` and only read opportunistically
  (`title`/`name`/`label`, `status`/`state`, `updated_at`). No field other than
  the id is required, and a session with no discoverable id is listed but cannot
  be opened.
- **A missing `code` in a JSON body is treated as success.** Some endpoints
  (notably `healthz`) may not use the envelope at all.
- **Terminal cell size is estimated locally.** `OmniTerminalController` measures
  a monospace `M` with `TextPainter` at 14px and derives `cols`/`rows` from the
  layout constraints minus `TerminalView`'s own `padding`. That estimate may not
  match the metrics `xterm` uses internally, so the daemon's PTY size can still
  drift slightly from the rendered grid.

## Reaching a daemon

**Same LAN.** Point the app at `http://<host>:<port>` of the machine running the
daemon, for example `http://192.168.1.20:8787`. The host must be reachable from
the phone, and the daemon's Host and Origin allowlists must accept the request —
a 403 on the WebSocket upgrade before the socket opens is that allowlist, not a
bad token. Plain `http` is fine on a trusted LAN; Android blocks cleartext HTTP
by default, so a cleartext traffic exception in the generated
`android/app/src/main/AndroidManifest.xml` may be needed (that file does not
exist until `flutter create .` has been run).

**Off-LAN.** Use the Remote Control tunnel in `packages/remote`, whose relay
defaults to `https://code-rc.omnicode.com`. The tunnel is loopback-gated
server-side and is disabled when the daemon runs with
`--dangerous-bypass-auth`. Start the tunnel on the daemon host and enter the
resulting `https://…` URL in this app; the client switches the WebSocket scheme
to `wss` automatically for `https` base URLs.

The token field takes the daemon's bearer token. It is stored in
`flutter_secure_storage`; only the base URL goes into `shared_preferences`.

## Layout

| Path | Role |
|---|---|
| `lib/main.dart` | Entry point. Builds `AppState` and `OmniThemeController`, wires both providers, applies the light/dark themes, picks the root screen. |
| `lib/src/theme/omni_palette.dart` | Light and dark design tokens transcribed from OmniCloud `apps/web/src/index.css`, plus `OmniTerminalTokens`. |
| `lib/src/theme/omni_theme.dart` | `OmniTheme.lightTheme` / `darkTheme`, `OmniRadius`, `OmniType`, `OmniMotion`, `OmniFont`, `omniPaletteOf`, `OmniThemeController`. |
| `lib/src/theme/omni_widgets.dart` | The component library: buttons, card, input, notice, status pill, app bar, theme toggle, brand mark, dialog, focus ring. |
| `assets/icon.svg` | Brand mark, copied from `/public/icon.svg`. Rendered by `OmniBrandMark`. |
| `lib/src/config/server_config.dart` | `ServerConfig` (base URL + token), all REST/WS path constants (`ApiPaths`), URL derivation. |
| `lib/src/config/settings_store.dart` | Persistence: base URL in `shared_preferences`, token in `flutter_secure_storage`. |
| `lib/src/api/envelope.dart` | Envelope decode, the single `ApiFailure` type, defensive JSON readers. |
| `lib/src/api/api_client.dart` | REST transport: auth header, envelope unwrap, error mapping, timeout. |
| `lib/src/api/sessions_api.dart` | Session and terminal calls plus `SessionRef`, `SessionPage`, `TerminalInfo`. |
| `lib/src/ws/ws_protocol.dart` | Protocol constants, frame models, encode/decode, payload builders. |
| `lib/src/ws/ws_client.dart` | Socket lifecycle, handshake, ping/pong, ack correlation, reconnect, streams. |
| `lib/src/ws/terminal_channel.dart` | One terminal: attach/detach/input/resize/close, output stream, `since_seq` tracking. |
| `lib/src/terminal/terminal_controller.dart` | Binds a channel to an `xterm` `Terminal`, derives and pushes `cols`/`rows`. |
| `lib/src/state/app_state.dart` | `ChangeNotifier` holding connection state, config, and the session list. |
| `lib/src/ui/*.dart` | Connect, sessions (+ terminals of one session), terminal screens. |

### WebSocket client design

- **Ack correlation.** Every control frame gets a client-generated `id`
  (`<counter>-<client_id>`). `sendControl` registers a `Completer` under that id
  and returns a future that completes when the matching `ack` arrives. Timeouts
  (15s default) and disconnects complete the future with an `ApiFailure`; all
  pending acks are failed on teardown so no caller hangs.
- **Handshake.** `connect()` opens the socket, waits for `server_hello`, then
  sends `client_hello` and waits for its ack before reporting `connected`. Each
  completed handshake is published on `handshakesCompleted`, which is how
  `TerminalChannel` knows to re-attach.
- **Ping/pong.** A `ping` frame is answered immediately with `pong` carrying the
  same nonce, fire-and-forget (the server sends no ack for `pong`). The client
  never pings.
- **Liveness.** Any inbound frame resets a timer of `heartbeat_ms * 3`. Expiry is
  treated as a dead connection and triggers the reconnect path.
- **Reconnect.** Exponential backoff from 500ms, doubling, capped at 15s, plus
  up to 25% jitter; attempts are unbounded until the user disconnects. A manual
  `connect()` cancels a pending backoff timer instead of racing it. Reconnect
  re-runs the full handshake with the same `client_id`.
- **`since_seq` resume.** `TerminalChannel` records the highest `terminal_output`
  seq it has written locally and sends it as `since_seq` on every attach, so a
  reconnect replays only what is missing. Output frames at or below that high
  water mark are dropped as duplicates.
- **Errors.** Server `error` frames, decode failures, transport drops, and ack
  rejections all become `ApiFailure` values on one `failures` stream that
  `AppState` surfaces in the UI. A `fatal` error stops auto-reconnect and moves
  the client to `failed`; a manual reconnect can still be requested.
  `resync_required` frames are published on their own stream and shown as a
  notice — phase 1 does not rebuild state from REST history yet.

## Known gaps

- No tests. The analyzer is clean but no behaviour is tested. See "Status:
  compiles, not yet daemon-verified".
- **The terminal grid is themed, but one token has nowhere to go.**
  `OmniTerminalTokens.xtermTheme` feeds `TerminalView`: gold cursor, gold-soft
  selection, and the dark palette's `text`/`bg` as foreground/background, with
  all 19 ANSI and search-hit colours taken from `TerminalThemes.defaultTheme` so
  an `xterm` palette change is inherited. `TerminalTheme` has **no cursor-accent
  field**, so `OmniTerminalTokens.cursorAccent` documents the intended colour
  and renders nothing. `OmniTerminalTokens.muted` and `.line` are likewise
  unused by the grid and exist for the chrome around it.
- **Geist is not bundled**, so the app renders in Flutter's default face. See
  "Fonts" in the design system section.
- **Launcher icons are not generated.** `android/` still carries the stock
  `flutter create` icons. See "App icon and launcher icons".
- The icon SVG uses a `<mask>` plus three gradients and has never been rendered.
  If `flutter_svg` 2.3.4 drops the mask, the eyes will not punch through; export
  a PNG and use `Image.asset` instead.
- `.btn-ghost:disabled` is not defined in the source stylesheet. `GhostButton`
  borrows the 0.6 of the other non-primary buttons.
- No `subscribe` / `subscribe_v2` usage yet: session events are received and
  exposed but not acted on, and no session is subscribed explicitly.
- `resync_required` is surfaced, not handled.
- No prompt sending, approvals, questions, transcript, or snapshot UI.
- No pagination UI for the session list (`before_id` / `after_id` /
  `page_size` are supported by `SessionsApi.listSessions` but the screen loads
  one page).
- **The release Android build cannot reach a daemon.**
  `android/app/src/main/AndroidManifest.xml` is stock `flutter create` output and
  declares no permission; only the `debug` and `profile` manifests add
  `android.permission.INTERNET`. Nothing sets `android:usesCleartextTraffic`, so
  an `http://` daemon URL is also blocked by Android's default cleartext policy
  on API 28+. Both fixes live in `android/`, outside `lib/`.
- No keychain or keystore configuration for `flutter_secure_storage`; it runs on
  the default `AndroidOptions`.

## Monorepo note

This folder sits under `apps/*`, which `pnpm-workspace.yaml` globs, but it
contains **no `package.json`**. pnpm therefore does not treat it as a workspace
package, Turbo does not see it, and the root Vitest configuration does not
resolve it. `pnpm check:workspace` stays green because that guard only fails
when a glob resolves to zero packages *with* a `package.json`, and
`apps/omnicode-cli` and `apps/omnicode-vis` still match.

That is deliberate. This is a Dart/Flutter app with its own toolchain; it is not
part of the TypeScript build graph and must not be pulled into it.
