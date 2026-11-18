---
"@omnicode/cli": patch
---

Close the Telegram pairing bypass: media albums and inline buttons from unpaired chats can no longer drive a session. Webhook mode now works behind the server's bearer auth, requires a webhook secret compared in constant time, and bot tokens are redacted from surfaced errors.
