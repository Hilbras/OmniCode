---
"@hilbras/omnicode": patch
---

Telegram pairing now only connects the chat: the first message offers a session
picker (continue an existing session or start a new one) instead of silently
binding the most recent session, and the picked message is routed to that
session. Approvals, plan reviews and questions answered from Telegram now clear
the pending CLI panel and show what was answered ("Answered from Telegram: …").
The Telegram probe timeout doubled to 20s with one retry, so slow networks no
longer surface "operation aborted due to timeout" in the connector card.
