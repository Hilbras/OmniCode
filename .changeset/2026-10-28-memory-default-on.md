---
"@hilbras/omnicode": minor
---

Memory is now on by default: sessions keep their task state across compaction, and trusted memories are injected without setting `OMNICODE_EXPERIMENTAL_MEMORY`. Turn it off with `OMNICODE_EXPERIMENTAL_MEMORY=0`, `[experimental] memory = false`, or `[memory] enabled = false`.
