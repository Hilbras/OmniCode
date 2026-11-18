# Telegram Connector Upgrade Plan v2

Supersedes `docs/telegram-upgrade-plan.md`. The original ten phases are
implemented; this plan covers the next six upgrades.

## Current baseline

- Bot loop, pairing, allowlist, per-chat bindings, commands, streaming, inline
  approvals/questions, attachments, offset persistence, token encryption,
  metrics, health, and fake-Bot-API E2E tests are in place.
- Telegram tests: `packages/engine/test/app/telegram` (26 passing).
- Telegram prompt origins carry `clientMetadata: [{ source: 'telegram' }]`, so
  the TUI renders external user messages.
- Final assistant replies render Markdown through Telegram HTML.
- Media intake supports Telegram photos and image documents.

## Definition of done

- All six phases below are implemented.
- `pnpm --filter @hilbras/omnicode-engine typecheck` passes.
- `pnpm --filter @omnicode/cli typecheck` passes.
- `pnpm --filter @omnicode/cli build` passes.
- Telegram tests pass without network access.
- Each phase has focused tests using the fake Bot API.

## Phase 1 — Full media pipeline

### Goals

Accept every common Telegram media kind, with clear limits and one prompt per
album.

### Tasks

1. Extend `TelegramUpdate` types:
   - `video`, `video_note`, `audio`, `voice`, `animation`, `sticker`
   - `media_group_id`
2. Add a shared media download helper:
   - `getFile` -> file URL -> size check -> materialize
   - stable `f_tg_<uuid>` file IDs
   - MIME detection from Telegram metadata and file extension
3. Photo intake:
   - choose the largest `photo` size
   - optional compression before materializing
4. Document intake:
   - image MIME -> `image_url`
   - video MIME -> `video_url`
   - audio MIME -> `audio_url`
   - everything else -> text attachment path
5. Direct media:
   - `video` -> `video_url`
   - `video_note` -> `video_url`
   - `audio` / `voice` -> `audio_url`
   - `animation` -> `video_url` with `image/jpeg` thumbnail fallback
   - `sticker` -> image or text fallback
6. Album grouping:
   - buffer updates sharing `media_group_id` for ~500 ms
   - combine attachments into one prompt with the album caption
7. Limits:
   - reject files over the Telegram Bot API `getFile` limit with a clear message
   - keep the 50 MB `sendDocument` limit for `/send`
8. Tests:
   - photo, image document, video, audio, voice, album
   - oversize rejection
   - download failure fallback text

### Acceptance

- Each supported media kind produces the correct `ContentPart`.
- An album produces one prompt, not one prompt per item.
- Oversize files are rejected before download.
- Failed downloads do not abort the whole prompt.

## Phase 2 — Session binding UX

### Goals

Let a Telegram chat choose and change its OmniCode session without typing raw
session IDs.

### Tasks

1. `/bind [sessionId]`:
   - no argument -> bind to the most recently updated session
   - argument -> bind to that session
2. `/sessions` inline picker:
   - up to 10 sessions, current one marked
   - callback data `s:<sessionId>`
   - callback switches the binding and edits the message
3. `/detach`:
   - remove the chat binding, keep allowlist
4. Keep `/new` and `/switch <id>` working.
5. Show the bound session in `/status`.
6. Tests:
   - bind to latest
   - bind explicit
   - inline switch
   - detach
   - unknown session error

### Acceptance

- A chat can switch sessions entirely through buttons.
- Binding persists across bot restarts.
- Detach leaves the chat paired but unbound.

## Phase 3 — Questions and plan review

### Goals

Make `AskUserQuestion` and `ExitPlanMode` fully usable from Telegram.

### Tasks

1. Question flow:
   - render every question, not only the first
   - single-select option buttons
   - multi-select toggle buttons plus `Done`
   - `Other` free-text answer through `ForceReply`
   - answer map keyed by question text
   - multi-select answers joined with `, `
   - cancel/dismiss path
2. Plan review:
   - detect `payload.display.kind === 'plan_review'`
   - render the plan body in Markdown
   - render approach buttons: `Approve: <label>`
   - add `Approve`, `Revise`, `Reject and Exit`
   - `Revise` asks for feedback via `ForceReply`
   - next text message responds with `{ decision: 'rejected', feedback }`
3. Callback state:
   - keep pending question/plan state in memory keyed by interaction ID
   - clean state on resolution, cancellation, and turn end
4. Tests:
   - plan approve with selected option
   - plan revise with feedback
   - reject and exit
   - multi-question single-select
   - multi-select with Done
   - free-text Other

### Acceptance

- Plan body and approach options appear in Telegram.
- Selected approach reaches `ExitPlanModeReview`.
- Question answers match the TUI response shape.
- Cancelled or expired interactions do not leak state.

## Phase 4 — Telegram chat polish

### Goals

Make the bot feel like a first-class chat client.

### Tasks

1. Typing indicator:
   - `sendChatAction` `typing` while a prompt runs
   - refresh every ~4 s
   - stop on completion, error, or timeout
2. Reply threading:
   - pass the user message ID into `routePrompt`
   - set `reply_parameters` on progress and final messages
   - `allow_sending_without_reply: true`
3. Inline command keyboards:
   - `/sessions` uses the Phase 2 picker
   - `/model` lists known models as buttons
   - `/permission` lists `manual`, `auto`, `yolo`
4. Reactions:
   - react to accepted prompts
   - optional failure reaction on error
5. Tests:
   - typing action starts and stops
   - reply parameters present
   - model and permission callback updates
   - reactions emitted

### Acceptance

- A running turn shows typing in Telegram.
- Replies are threaded to the triggering message.
- Model and permission changes work through buttons.

## Phase 5 — Markdown edge cases

### Goals

Keep formatting correct for long replies, code, and tables.

### Tasks

1. Code-fence-safe chunking:
   - split by lines
   - close an open fence at chunk end
   - reopen it at the next chunk
2. Tables:
   - detect Markdown table blocks
   - render as aligned `<pre>` text
3. Unsupported Markdown:
   - convert headings, lists, and horizontal rules
   - strip unsupported constructs instead of leaking raw markers
4. HTML safety:
   - escape all text
   - never emit unsupported Telegram tags
5. Tests:
   - long code block split
   - table rendering
   - nested bold/italic/code
   - unclosed fence
   - raw `<script>` escaped

### Acceptance

- Replies over 4,000 chars send without parse errors.
- Code fences remain balanced across chunks.
- Tables are readable in Telegram.
- No raw HTML or Markdown markers leak for supported constructs.

## Phase 6 — Reliability

### Goals

Make the connector safe to run continuously and in server deployments.

### Tasks

1. Webhook mode:
   - config `mode: 'polling' | 'webhook'`
   - `webhookUrl`, `webhookSecret`
   - `setWebhook` / `deleteWebhook`
   - server route to receive updates
   - secret-token validation
2. Multi-process lock:
   - lock file with PID, host, startedAt
   - stale-lock detection
   - `start` fails with a clear error if another live process holds it
3. Retry queue:
   - persist failed sends and media downloads
   - retry with bounded backoff
   - surface retry counts in metrics
4. Tests:
   - lock conflict and stale lock takeover
   - webhook secret rejection
   - retry success after transient failure
   - retry exhaustion

### Acceptance

- Two bot processes cannot poll the same token.
- Webhook updates are rejected without the secret.
- Transient send/download failures retry and recover.
- Persistent failures are visible in status and metrics.

## File map

- `packages/engine/src/app/telegram/telegramService.ts` — bot loop, commands,
  routing, media, questions, reliability.
- `packages/engine/src/app/telegram/markdown.ts` — Markdown to Telegram HTML.
- `packages/engine/src/app/telegram/types.ts` — status, bindings, metrics.
- `packages/engine/src/app/telegram/telegram.ts` — connector interface.
- `packages/engine/test/app/telegram/` — fake Bot API and phase tests.
- `packages/server/src/routes/connectors.ts` — REST status/health/webhook.
- `packages/server/src/protocol/rest-connector.ts` — wire schemas.
- `apps/omnicode-cli/src/tui/controllers/connectors.ts` — `/connectors` UI.
- `apps/omnicode-cli/src/tui/controllers/session-event-handler.ts` — external
  prompt rendering.

## Risks

- Telegram Bot API file downloads are size-limited; media must be rejected
  before download when possible.
- Plan review and questions are stateful; stale callback state must be cleaned.
- Webhook mode changes the server surface; keep polling the default.
- Long Markdown chunking is easy to get wrong; test with code fences and tables.

## Audit follow-up (2026-11-18)

Fixed:

- **Webhook mode was unreachable.** The update route lives under `/api/v1`, and
  the bearer hook rejected Telegram's callback before the connector saw it. The
  exact `POST /api/v1/connectors/telegram/webhook` path is now exempt, and the
  connector itself requires `mode = 'webhook'` plus a configured secret.
- **Secret checks are constant-time** (`timingSafeEqual`), and an empty or
  missing secret now rejects instead of accepting every caller.
- **The PUT route dropped `mode`, `webhookUrl`, and `webhookSecret`** even though
  the request schema accepted them; all five settings are persisted now.
- **Webhook start requires a secret** instead of registering a webhook without
  one.
- **Bot tokens are redacted** from error text surfaced in `status.error`,
  `lastError`, and chat error replies (`/bot<token>/` and bare token shapes).
- **A media album bypassed pairing.** Albums were buffered before the allowlist
  check, and `flushMediaGroup` never re-checked it, so any chat could send two
  photos and drive the newest session. Albums from unpaired chats are now
  refused at update time and re-checked before the prompt runs.
- **Inline buttons bypassed pairing.** `handleCallbackQuery` now checks the
  allowlist before switching sessions or applying model/permission buttons.
- **Webhook updates are deduplicated and counted.** A repeated `update_id` is
  acknowledged once, and webhook mode now updates `lastUpdateAt` and the
  update/message metrics like polling does.
- `packages/channels` Telegram verification now rejects an empty secret and
  compares with `timingSafeEqual`.

Tests: engine 57 (7 new), server connectors 9 (3 new), channels 26 (1 new).

Open, deliberately not changed here:

- **Three Telegram entry points** coexist: the engine connector
  (`/connectors` + TUI), `packages/channels`' Telegram adapter, and the
  `omnicode-telegram` plugin bridge. They have different config formats
  (encrypted vs plaintext `botToken`), different command sets, and different
  auth models. Pick one before documenting Telegram as a single product.
- **`packages/channels` Telegram is outbound-only.** The adapter sends messages
  and `handleUpdate` is never wired to an inbound server or poller, so enabling
  it in `channels.json` produces a bot that never receives. The plugin bridge or
  the engine connector is the real inbound path.
- **Two pollers conflict.** The `omnicode-telegram` plugin bridge and the engine
  connector both long-poll, so running both against one token makes Telegram
  answer one with `409 Conflict`. The CLI's `channels.json` runtime is not a
  third poller (its Telegram adapter is send-only) but shares the same token
  env var, so it can send as the bot while another process receives.
- **The plugin's standalone default home is stale** (`~/.omnicode` vs the
  product's `~/.omnicode`) and its README says to run it directly. It only
  works when the plugin host injects `OMNICODE_HOME`. It also cannot read a
  token saved by the TUI (encrypted, no plaintext `botToken`).
- **Group chats share one allowlist entry.** Adding a group id lets every member
  drive the agent, including `/permission yolo`; there is no per-user check.
