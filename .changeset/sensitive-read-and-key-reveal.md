---
"@omnicode/cli": patch
---

Ask before reading credentials in auto mode, and stop returning a stored provider key to remote callers. A `Bash` command whose arguments name a sensitive path (`.env`, `~/.ssh/id_rsa`, `.npmrc`, …) and a `Grep` whose `path` is sensitive now take the same approval as the equivalent `Read`. `GET /api/v1/providers/{id}` reveals the stored `api_key` only to a loopback client; remote callers receive `has_api_key` and no secret.
