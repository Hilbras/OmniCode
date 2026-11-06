# Omnicode Telegram

Drive Omnicode from a Telegram chat — pick a session, send prompts, and change
the model, profile, thinking level, permission mode and plan mode.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Write `~/.omnicode/telegram.json`:

   ```json
   { "botToken": "123456:ABC...", "allowedChatIds": [] }
   ```

3. Start the daemon and message the bot once:

   ```sh
   node bin/omnicode-telegram.mjs
   ```

   It replies with your chat id and refuses every command.
4. Put that id in `allowedChatIds`, restart, and you are in.

The daemon discovers the running Omnicode server by itself, from
`~/.omnicode/server/instances/*.json` and `~/.omnicode/server.token` — no manual
URL or token needed.

## What it sets on your bot

Every start, the bridge configures the bot itself so the chat shows a working menu:

- the command list that appears when you type `/`
- the menu button that opens that list
- the bot's short description and description
- the bot's profile photo from `assets/avatar.jpg` — uploaded once, and again only
  when that file changes

All of it is best-effort: if Telegram rejects a step, the bridge logs it and keeps
running. Setting the photo needs a `.JPG` (the Bot API does not accept PNG for
profile photos), which is why the plugin ships `avatar.jpg`.

## Commands

| Command | Effect |
|---|---|
| `/sessions` | projects only, with session and running counts |
| `/project <n\|name>` | open a project and list all its sessions |
| `/new <title>` | create a session in the open project |
| `/status` | which sessions are working right now |
| `/models` | pick a model by number, inside the chosen provider |
| `/provider` | narrow the model list to one provider |
| `/use <n>` | select a session from the open project |
| *(any text)* | prompt the selected session |
| *(a photo)* | send the image to the selected session |
| `/last` | newest assistant reply |
| `/usage` | tokens used by this session (input, output, cache) |
| `/diff` | git status and diffstat of the workspace |
| `/files` | files the last turn changed |
| `/notify <on\|off>` | report each turn when it finishes |
| `/stop` | cancel the running turn |
| `/model <alias\|clear>` | model for the next prompt |
| `/profile <name\|clear>` | profile for the next prompt |
| `/thinking <level\|clear>` | thinking level |
| `/permission <mode\|clear>` | permission mode |
| `/plan <on\|off\|clear>` | plan mode |
| `/settings` | list the model catalog |
| `/current` | selection and pending overrides |
| `/help` | the command list |

## Finish reports

When a turn in the session the chat selected finishes, the bot sends a formatted
report: duration, the project and session, step and tool counts with a
per-tool breakdown, the files an Edit or Write touched, and the agent's final
message rendered as HTML (bold, code, quoted). A turn you started from the
desktop app counts too. `/notify off` mutes it, `/notify on` turns it back on.

`/status` answers the other question: which sessions are working right now,
with their project, their elapsed time, and which one this chat selected.

## Approvals and questions

When a turn stops to ask for permission, the chat shows the tool, the action and a
preview of the input, with **Allow**, **Deny** and **Allow for this session**
buttons. Questions arrive as one button per option, and while one is open any plain
reply becomes the answer: numbers pick options (`1` or `1,3`), anything else is sent
as a free-form answer. An approval answered somewhere else reports that instead of
failing silently.

## Progress

A running turn gets one message that keeps changing — `⏳ Working · step 8 · Bash ·
9 tools · 3m 12s` — and that same message is edited into the finish report when the
turn ends, so a chat shows one entry per turn rather than silence followed by a wall
of text. Reports too long for one message arrive as a summary plus a `report.md`
attachment.

## Images

Send a photo, or an image file up to 5 MB, and it goes to the selected session as an
image the agent can look at; the caption becomes the prompt. Other file types are
refused with a note saying why.

## Browsing

`/sessions` lists projects only — how many sessions each holds and how many are
running right now. `/project 2` (or `/project <part of the name>`) opens one and
lists every session in it; that list is what `/use <n>` numbers. `/new <title>`
creates a session in the open project and selects it.

The bridge re-discovers the app's server every few seconds — the desktop app
binds a new port on each launch — so restarting the app reconnects by itself,
and every allowed chat gets a `✅ Connected` message when it does.

The bot's own menu follows that: before a session is chosen it offers the
browsing commands, and once one is selected it switches to the session commands
(`/new`, `/models`, `/provider`, `/thinking`, `/stop`, …) for that chat.

## Run it persistently

The app does not start this bridge, so a plain `node bin/omnicode-telegram.mjs`
dies when that shell, session or app closes. On Linux, install it as a user
service so it survives restarts and reboots:

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/omnicode-telegram.service <<EOF
[Unit]
Description=Omnicode Telegram bridge
After=network-online.target

[Service]
ExecStart=$(command -v node) /path/to/omnicode-telegram/bin/omnicode-telegram.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now omnicode-telegram
loginctl enable-linger "$USER"
```

`Restart=always` also covers the transient network failures the Bot API throws.

## Security

The bot fails closed: only chat ids in `allowedChatIds` can do anything. Every
other chat receives its own chat id and a refusal, and nothing else. It also
talks only to `127.0.0.1`, so it never exposes your server.

Treat the bot token like a password — anyone holding it can read your bot's
updates.

## State

`~/.omnicode/telegram-state.json` holds the poll offset and each chat's selected
session and overrides. Delete it to reset.

## Requirements

Node 18+ (uses the built-in `fetch`), and a running Omnicode server.

## Tests

```sh
node --test test/*.test.mjs
```

Covers the duration and markdown formatters, message chunking, project grouping,
the finish report, the keyboards, and the approval and question payloads. It runs
offline: no server, no bot token.
