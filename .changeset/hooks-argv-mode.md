---
"@omnicode/cli": patch
---

Run hook commands as an argument list instead of through a shell, and block the matched tool when a hook cannot be parsed or spawned. A hook that relies on shell syntax (pipes, redirection, `&&`) must set `shell: true`; a hook that fails to start now blocks the tool call instead of being ignored.
