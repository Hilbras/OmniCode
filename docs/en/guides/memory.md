# Memory

Memory lets Omnicode carry facts, preferences, and unfinished work from one session to the next, so a new session starts from what the project already knows instead of from nothing. It is experimental and on by default; the next section shows how to turn it off.

## What memory keeps

- **Task state** — when a long conversation is compacted, its objective, decisions, and next step are stored, so a resumed session can pick the work back up.
- **Facts the agent saved** — notes about the project that the agent chose to keep, with the file it read as evidence.
- **Preferences you stated** — instructions such as how you like commit messages written.

Every memory records where it came from, which project it belongs to, and how much it is trusted. Stored memory is context, not instructions: it cannot change permissions, skip approvals, or grant tool access.

## Turning memory off and on

Memory is on unless you turn it off. Turn it off for one run:

```sh
OMNICODE_EXPERIMENTAL_MEMORY=0 omnicode
```

Or turn it off in `$OMNICODE_HOME/config.toml`:

```toml
[experimental]
memory = false
```

The environment variable wins over the config file, so `OMNICODE_EXPERIMENTAL_MEMORY=1` turns memory back on for one run without editing the file.

```toml
[memory]
# A second switch, on by default. Both this and the flag must be on.
enabled = true
# Where the store lives. Defaults to $OMNICODE_HOME/memory.
dir = "/absolute/path/to/memory"
# Reject a single memory longer than this.
maxContentChars = 4000
```

## Scopes

A memory is visible only inside the scopes it was written to:

| Scope | Visible in |
|---|---|
| `global` | every project on this machine |
| `workspace` | the current workspace |
| `repository` | the current git repository |
| `session` | the current session only |

A memory saved for one repository is never returned in another one, and the agent cannot read, change, or forget a memory outside the scopes of the session it is running in.

## Trust

| Level | Meaning |
|---|---|
| `unverified` | no backing evidence — including anything the agent saved itself |
| `trusted` | you stated it, or you confirmed it |
| `verified` | a cited file still matches what was captured |
| `system` | owned by the application |

The agent can never raise its own trust. It can save a memory, and that memory stays `unverified` until you confirm it or evidence backs it.

Search-based injection only surfaces `trusted` and above, so an unverified note can be found by an explicit search but never appears in a conversation on its own.

## Reviewing memories

```text
/memory                          list memories visible to this session
/memory list <scope> <status>    filter by scope and lifecycle
/memory show <id>                full provenance for one memory
/memory confirm <id>             promote unverified to trusted
/memory forget <id> [reason]     invalidate a memory
/memory export [path]            write every visible memory to JSON
```

Scopes are `global`, `workspace`, `repository`, and `session`; statuses are `active`, `superseded`, `expired`, `invalidated`, and `all`.

Forgetting a memory invalidates it — the record stays for auditability and stops being used. Nothing in the normal flow hard-deletes a memory.

If a file that a memory cites changes, the memory is demoted to `unverified` the moment the change is noticed, stops being injected, and `/memory list` marks it `(stale)`. Use `/memory show <id>` to see which citation changed.

The web UI reads the same data through `/api/v1/memory`; see [Server API](../reference/server-api.md).

## Where memories live

The store lives in `$OMNICODE_HOME/memory/` by default; set `dir` in the `[memory]` section or `OMNICODE_MEMORY_DIR` to move it. One process writes at a time. If a second Omnicode instance opens the same store, it reads normally and refuses writes instead of corrupting them.

## What memory does not do

- It does not embed or vectorize anything. Retrieval is lexical, with light stemming and a small synonym table for coding terms.
- It does not let the agent approve its own memories, change its own trust, or widen its own scopes.
- It does not summarise with a model. The review queue applies deterministic rules only.
