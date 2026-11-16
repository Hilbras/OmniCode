---
"@omnicode/cli": patch
---

Report the provider's content-safety rejection as a filtered response instead of a generic API error, and stop retrying it: the turn now stops with `provider.filtered` and the screening message.
