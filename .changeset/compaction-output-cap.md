---
"@hilbras/omnicode": patch
---

Lower the compaction output cap to 64k and shrink it automatically when a provider rejects the requested max_tokens, so compaction no longer fails on providers that cap output tokens below the model context size.
