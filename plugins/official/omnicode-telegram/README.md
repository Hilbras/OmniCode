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
| `/sessions` | list sessions grouped by project |
| `/status` | which sessions are working right now |
| `/use <n>` | select a session |
| *(any text)* | prompt the selected session |
| `/last` | newest assistant reply |
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

When a turn in the session the chat selected finishes, the bot sends a report:
how long it took, how many steps and which tools ran, which files it changed,
and the agent's final message. A turn you started from the desktop app counts
too. `/notify off` mutes it, `/notify on` turns it back on.

`/status` answers the other question: which sessions are working right now,
with their project, their elapsed time, and which one this chat selected.

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
