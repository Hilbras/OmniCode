---
"@omnicode/cli": patch
---

Ask for approval in auto mode for every tool that is not classified as safe, including tools you registered yourself, and stop silently approving `WebSearch`, `FetchURL`, `Agent`, and `AgentSwarm`. Approve once and the same action is remembered for the session, or pre-approve a tool with an allow rule under `[[permission.rules]]` in `config.toml`.
