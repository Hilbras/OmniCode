---
"@omnicode/cli": patch
---

Finish the memory writer before `-p` and TUI exit. The post-turn memory call is now tracked as auxiliary work, and print mode plus the TUI wait for it (bounded at 15 s / 5 s) before disposing the agent, so a fact stated in a one-shot prompt is persisted and the staged memory is available to the next run. A writer proposal that matches a fact the deterministic lane already stored is skipped instead of creating a conflicting duplicate.
