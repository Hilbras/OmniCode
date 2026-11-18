---
name: telegram-remote
description: Run and drive the Omnicode Telegram bridge, which lets a Telegram chat list sessions, pick one, send prompts, and change the model, profile, thinking level, permission mode and plan mode. Use when the user wants to control Omnicode from Telegram, asks why the Telegram bot is not responding, or wants to add or change allowed Telegram chats.
---

# Telegram remote control

The bridge is a small long-polling daemon that talks to the local Omnicode
server over loopback. Nothing listens on an inbound port; it calls Telegram
instead, so it works behind NAT.

## Start it

```sh
node <plugin>/bin/omnicode-telegram.mjs
```

It reads `~/.omnicode/telegram.json`:

```json
{ "botToken": "<from @BotFather>", "allowedChatIds": [123456789] }
```

On first run it writes that template and exits, so the user can fill it in.
`TELEGRAM_BOT_TOKEN` overrides `botToken`.

## Safety

The bot fails closed. Chat ids not listed in `allowedChatIds` receive only their
own chat id and a refusal — nothing about the machine or its sessions. Do not
widen `allowedChatIds` on the user's behalf without them asking.

## What a chat can do

- `/sessions` then `/use <n>` to select a session
- plain text to prompt the selected session
- `/last` to read the newest assistant reply
- `/stop` to cancel the running turn
- `/model`, `/profile`, `/thinking`, `/permission`, `/plan` set an override for
  the next prompt; `clear` removes it
- `/settings` lists the model catalog

Overrides are per chat and persist in `~/.omnicode/telegram-state.json`.

## Diagnosing a silent bot

1. Is the daemon running? It logs `connected to http://127.0.0.1:<port>`.
2. Is Omnicode up? The daemon discovers the server from
   `~/.omnicode/server/instances/*.json` and reads `~/.omnicode/server.token`;
   with no live server it exits with "no running Omnicode server found".
3. Is the chat allowed? An unlisted chat gets a refusal naming its chat id.
