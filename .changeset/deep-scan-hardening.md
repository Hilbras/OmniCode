---
"@omnicode/cli": patch
---

Harden the local server and file matching. An absolute-form request target (`GET http://host/api/v1/...`) no longer skips bearer authentication; opening or revealing a file on Windows now goes through an argument array instead of `cmd /c start`, so a workspace filename containing `&` cannot run a second command; MCP endpoints written as IPv4-mapped IPv6 (`::ffff:10.0.0.1`), unspecified, ULA, or link-local addresses are refused unless `allowPrivateNetwork` is set; and `**/name` now matches `name`, `a/name`, and `a/b/name` in the Glob tool and SSH glob expansion.
