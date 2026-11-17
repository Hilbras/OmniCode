---
"@omnicode/cli": minor
---

Add `omnicode import` for moving in from another coding agent. It reads a Claude Code, Codex, or Qwen Code install and reports the agents, skills, and MCP servers it finds, together with every parse warning and the file it came from; `--json` prints the same as a machine-readable bundle with MCP env values redacted. With `--apply` it installs the skills into `<home>/skills` (the directory the runtime already loads) and merges the MCP servers into `<home>/mcp.json` with `0600` permissions, keeping existing entries unless `--force` and refusing to overwrite a file it cannot parse. Agent files are reported but not written: this runtime builds agents from profiles and session state, so there is no user agents directory to install them into.
