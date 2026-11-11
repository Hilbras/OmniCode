# Telegram Connector Upgrade Plan

Goal: turn the current Telegram connector from config/status-only into a production-ready bridge between Telegram chats and OmniCode sessions.

## Current baseline

- `packages/engine/src/app/telegram/telegramService.ts` reads `telegram.json` and `telegram-state.json`.
- It can report `not-configured`, `awaiting-chat`, `ready`, running/PID/heartbeat, bot identity, and errors.
- It does **not** run a bot, poll updates, pair chats, bind sessions, route messages, or send replies.
- The TUI `/connectors` page can save a bot token, set the bot name to OmniCode, and upload the logo.
- The TUI footer shows a global Telegram badge after a session opens.

## Target architecture

- `TelegramApiClient` — typed Bot API wrapper: `getMe`, `getUpdates`, `sendMessage`, `editMessageText`, `setMyCommands`, `setChatMenuButton`, `getFile`, etc.
- `TelegramUpdateLoop` — long polling with offset persistence, de-duplication, backoff, heartbeat.
- `TelegramPairingService` — one-time pairing codes, deep links, expiry, allowlist.
- `TelegramSessionBridge` — maps chats to sessions, creates/resumes sessions, sends prompts, streams replies.
- `TelegramCommandRouter` — `/start`, `/help`, `/new`, `/sessions`, `/switch`, `/status`, `/model`, `/stop`, `/cancel`, `/compact`, `/approve`, `/deny`.
- `TelegramApprovalBridge` — inline keyboards for approvals/questions.
- `TelegramAttachmentBridge` — upload/download files and images.
- `TelegramSecurity` — encrypted token storage, allowlist, rate limits, permissions, audit log.
- `TelegramObservability` — health, metrics, last update/error, uptime, TUI status.

## Data model

`~/.omnicode-v/telegram.json`:

```json
{
  "botToken": "...",
  "allowedChatIds": [123456],
  "pairing": {
    "code": "ABCD1234",
    "expiresAt": 1760000000000
  },
  "bindings": {
    "123456": {
      "sessionId": "...",
      "workspaceRoot": "/path/to/workspace",
      "model": "gpt-4.1",
      "permission": "ask"
    }
  },
  "settings": {
    "permission": "ask",
    "maxConcurrentSessions": 2,
    "streaming": true
  }
}
```

`~/.omnicode-v/telegram-state.json`:

```json
{
  "pid": 12345,
  "heartbeatAt": 1760000000000,
  "lastUpdateId": 987654321,
  "lastUpdateAt": 1760000000000,
  "lastError": null,
  "metrics": {
    "updates": 0,
    "messages": 0,
    "errors": 0
  }
}
```

All files use mode `0600`.

## Phase 1 — Pairing + allowlist

- Add pairing code generation with expiry.
- Add `createPairingCode`, `consumePairingCode`, `addAllowedChat`, `removeAllowedChat`.
- Add deep link: `https://t.me/<bot>?start=<code>`.
- Add bot update loop skeleton.
- Handle `/start <code>`: validate, add chat ID, reply.
- Handle `/help` and `/status`.
- Expose pairing/start/stop through REST + TUI.
- Acceptance: token → generate code → `/start code` in Telegram → chat appears in allowlist.

## Phase 2 — Per-chat session binding

- Store `chatId → sessionId` bindings.
- Create a session for a new chat.
- Resume/switch existing sessions.
- Add `/sessions`, `/switch`, `/new`.
- Show Telegram badge on session rows.
- Acceptance: each chat owns a session; two chats do not share state.

## Phase 3 — Bot commands

- Add command router and `setMyCommands`.
- Commands: `/start`, `/help`, `/new`, `/sessions`, `/switch`, `/status`, `/model`, `/stop`, `/cancel`, `/compact`, `/approve`, `/deny`.
- Add menu button and short description.
- Acceptance: every command has a test and a help entry.

## Phase 4 — Inline approvals/questions

- Send inline keyboards for approvals and questions.
- Map callback queries to the active session.
- Add approve/deny/choose handlers.
- Acceptance: a tool approval can be completed entirely from Telegram.

## Phase 5 — Streaming + progress

- Send one progress message per turn.
- Throttle `editMessageText`.
- Show thinking/tool status.
- Replace progress with final answer.
- Add stop button.
- Acceptance: long turns show progress and can be stopped.

## Phase 6 — Attachments

- Upload images/files from Telegram into the session.
- Download generated files/artifacts.
- Handle captions, file size limits, MIME types.
- Acceptance: image and file round-trip tests.

## Phase 7 — Reliability

- Persist update offset.
- De-duplicate by `update_id`.
- Reconnect/backoff.
- Heartbeat/PID.
- Auto-restart and graceful shutdown.
- Queue messages while a turn is running.
- Acceptance: restart resumes without duplicate replies.

## Phase 8 — Security

- Encrypt bot token at rest.
- Pairing code rate limit and expiry.
- Allowlist management.
- Per-chat permission mode.
- Max message length and concurrency.
- Audit log.
- Acceptance: unknown chats are rejected; secrets are not plaintext.

## Phase 9 — Observability

- `/health` REST endpoint.
- `/status` in Telegram.
- Last update/error, uptime, counters.
- Structured logs.
- TUI status page with start/stop/test.
- Acceptance: health reflects running state and last error.

## Phase 10 — Testing

- Fake Telegram Bot API server.
- Unit tests: pairing, allowlist, offset, routing, rate limit.
- E2E: token → pairing → session → message → reply.
- Reconnect and duplicate-update tests.
- Acceptance: CI runs all tests without network access.

## File map

- `packages/engine/src/app/telegram/` — service, bridge, pairing, commands, types.
- `packages/server/src/routes/connectors.ts` — REST status/pair/start/stop/bindings.
- `packages/SDK/src/` + `packages/API/src/` — RPC methods.
- `apps/omnicode-cli/src/tui/controllers/connectors.ts` — TUI actions.
- `apps/omnicode-cli/src/tui/components/chrome/footer.ts` — status badge.
- `packages/engine/test/app/telegram/` — tests.

## Definition of done

- All 10 phases complete.
- `pnpm typecheck` and `pnpm build` pass for affected packages.
- E2E test covers token setup → pairing → session binding → message → reply.
