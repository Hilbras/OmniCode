---
"@hilbras/omnicode": patch
---

Stop repeating an MCP tool call that failed before a result arrived, unless the server marked the tool read-only; the failed call now reports that it may already have run.
