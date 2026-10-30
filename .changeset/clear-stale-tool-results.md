---
"@hilbras/omnicode": patch
---

Replace older tool outputs with short placeholders once a conversation fills half the context window, so the model no longer sees their full text; set `[compaction] clear_tool_results = false` or `OMNICODE_COMPACTION_CLEAR_TOOL_RESULTS=0` to keep sending them in full.
