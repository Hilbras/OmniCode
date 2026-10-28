---
"@hilbras/omnicode": patch
---

Add a `[compaction]` config section: `auto` turns automatic compaction on or off, `model` picks a separate model for writing summaries, `keep_tokens` caps how much recent assistant and tool output is kept verbatim after compaction, and `tool_output_max_chars` caps each tool output in that slice; each can also be set with `OMNICODE_COMPACTION_AUTO`, `OMNICODE_COMPACTION_MODEL`, `OMNICODE_COMPACTION_KEEP_TOKENS`, or `OMNICODE_COMPACTION_TOOL_OUTPUT_MAX_CHARS`.
