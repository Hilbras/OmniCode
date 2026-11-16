---
"@omnicode/cli": patch
---

Store the Telegram bot token encrypted at rest instead of in plain text; the connector keeps working and an existing plain-text token is migrated the next time settings are read.
