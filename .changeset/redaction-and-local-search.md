---
"@omnicode/cli": patch
---

Mark known credential shapes in tool output before it reaches the provider or the session log, and make `SearchSessions` work without a running daemon. PEM private keys, AWS access-key ids, `sk-…` keys, GitHub/Slack/GitLab tokens, JWTs, and long `Bearer` values are replaced with `[redacted:<kind>]`; ordinary code, hashes, and short fixtures are untouched, and `OMNICODE_TOOL_OUTPUT_REDACTION=0` disables the marking. Local session search now reads the on-disk `wire.jsonl` files, so the tool returns matches in a CLI-only run instead of reporting that the server is required.
