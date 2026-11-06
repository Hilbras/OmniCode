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

A running turn gets one message that keeps changing, and what it shows is the agent's
own words rather than its plumbing:

```
⏳ Working · 4m 2s

Now updating the tests to the new behaviour:
```

Tool names, commands and step counts are deliberately left out — the point is to read what
the agent says it is doing. The newest text frame of the turn is shown, escaped and cut to
500 characters so a long paragraph cannot flood the chat. That same message is edited into
the finish report when the turn ends, so a chat shows one entry per turn rather than
silence followed by a wall of text. Reports too long for one message arrive as a summary
plus a `report.md` attachment.

## Images and videos

Send a photo, an image file up to 10 MB, or a video up to 20 MB, and it goes to the
selected session; the caption becomes the prompt.

A video arrives as still frames — up to six, sampled roughly every two seconds — because
the agent reads images, not video streams. Frame extraction uses ffmpeg found at
`OMNICODE_FFMPEG`, then `/opt/Omnicode/resources/ffmpeg/ffmpeg` (the desktop bundle),
`/usr/local/bin/ffmpeg`, `/usr/bin/ffmpeg`. With no ffmpeg the bot says so and names the
paths it looked in, instead of failing quietly. Other file types are refused with a note
saying why, and anything over the size limit names both the size and the limit.

## Alerts from other sessions

While you drive one session, the bridge also watches the others. When a session that was
working stops, the chat gets a short alert:

```
🔔 OmniHilbras · hi — done in 1m 5s
<first line of its reply>
[ Open this session ]
```

so you learn about it without leaving the session you are in, and one tap switches the chat
to it — clearing, renaming the header and posting that session's last report, exactly like
`/use`. The session you have selected is excluded, since its own report already covers it.

Telegram has no way for a bot to raise a *service* notification (the centred "X pinned a
message" line); only messages can notify, so this arrives as a very short message.
`/notify others off` turns these alerts off while keeping finish reports, and `/notify
off` silences everything.

## Selecting a session

Choosing a session (`/use <n>`, or tapping one in `/project`) does three things:

1. **Clears the chat.** Every message the bot sent in that chat is deleted, so each
   session starts from a clean slate.
2. **Pins a header** that names the session you are driving:

   ```
   📌 OmniHilbras · hi
   session_9cf2b4bb-b8b2-42a8-b72b-6c71da4eb06d
   ✅ idle
   ```

   The header is edited in place on every switch and whenever the session changes state
   (`⏳ working`, `🔐 waiting for approval`, `❓ waiting for an answer`, `⚠️ failed`), so the top
   of the chat always answers "which session am I in, and is it busy?". Editing has no
   limit, which is why this — not the bot's name — is the reliable indicator.
3. **Posts the last report** from that session — the newest finished turn, with its
   duration, tools, files and final message.

Anything that session is *waiting on* is posted right after the report — a pending
approval with its Allow / Deny buttons, or a pending question — so entering a stalled
session from your phone tells you what it needs. Because the chat is emptied first, a
waiting item is always announced again, even if an earlier copy of the notice was
deleted with the rest of the history.

## Clearing old messages: `/purge`

A bot can only delete messages whose ids it recorded itself, and Telegram has no way to
list a chat's history — so messages from before the bridge started keeping that ledger
are unreachable, and a switch reports them as undeletable instead of pretending the chat
is empty. `/purge` closes that gap: it walks the chat's message ids and deletes every one
the bot is allowed to remove, then re-posts and pins the last report. Run it once after
installing or upgrading, and each switch keeps the chat clean from then on.

Both directions are tracked: messages the bot sent **and** messages you sent it. In a
private chat a bot is allowed to delete incoming messages too, so a switch empties the
chat completely — your commands go with the bot's replies.

Limits worth knowing: only messages younger than 48 hours can be deleted by anyone, and
anything older survives — `/purge` and each switch report the count they could not
remove rather than claiming success.

The bot's name is global — one bot has one name, in every chat — and by default the bridge
sets it to `OmniCode - <project> · <session title>`. Telegram allows only about one name
change per day, so that lags: after a switch the name can be a day behind. The bridge
skips the call when the name already matches, and after a refusal stays quiet until
Telegram's own retry window has passed rather than pushing that window out again.

`/name off` stops the bridge renaming altogether, which is the sensible choice if you have
set the name by hand: the pinned header above is the per-session indicator, and it costs
nothing. `/name on` resumes renaming, and `/name` alone reports the name Telegram holds,
the name the bridge wants, and any remaining cooldown.

## Browsing

`/sessions` lists projects only — how many sessions each holds and how many are
running right now. `/project 2` (or `/project <part of the name>`) opens one and
lists every session in it; that list is what `/use <n>` numbers. `/new <title>`
creates a session in the open project and selects it.

Both lists show **five entries at a time** with a `▸ More` button (and `‹ Back`) rather
than a wall of buttons, and the numbering keeps counting across pages: the second page
of sessions starts at 6, so `/use 7` means the same session wherever it is shown.
`/sessions 2` and `/project 2 2` jump straight to a page.

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
