---
"@hilbras/omnicode": patch
---

Avoid sending the same tool output twice in one conversation: a repeated result now points at the first copy. Set OMNICODE_EXPERIMENTAL_TOOL_RESULT_DEDUPE=0 to turn it off.