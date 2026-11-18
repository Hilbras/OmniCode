# Model Context Protocol

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open protocol that lets models safely call tools exposed by external processes or services: reading GitHub issues, querying databases, or operating the local file system. Omnicode CLI acts as an MCP client to connect these external tools and exposes them to the Agent alongside built-in tools (`Read`, `Bash`, `Grep`, etc.) with no behavioral difference.

MCP tool results can include text (`content`) and structured data (`structuredContent`). Omnicode CLI makes both available to the agent and omits the structured copy only when it can confirm that a text block already contains the same complete JSON value. Text summaries and media do not replace structured records.

Omnicode CLI preserves embedded MCP attachments that cannot be delivered directly because of format or size limits. Embedded images, audio, and video are saved even when they can be delivered unchanged, because provider conversion or later history reduction may omit them. Session-attachment readers remain available without workspace filesystem access when the model supports the corresponding content. Originals are retained in the session's media storage instead of an evictable image cache. Saved originals, including images preserved during compression, have absolute paths and stable `omnicode-file://` references. Pass a reference as the `path` to `Read` or `ReadMediaFile`; bytes are read from the current session's storage even when the workspace runtime cannot access it. Pagination keeps the reference, including after a fork. For binary formats that `Read` cannot open, its error includes a server-local path when available; an external converter must have access to that filesystem. Text attachments such as CSV, HTML, JSON, and plain SVG use readable extensions.

Attachment paths and compression details share the tool-output budget. Large lists are saved to a text file, with a short pointer that remains visible when accompanying text is shortened; the agent can pass the list’s `omnicode-file://` reference to `Read` and page through it. Canceling the tool stops subsequent attachment processing and signals active writes. If decoding or saving fails, the result explicitly reports that the original could not be preserved while retaining other usable output. Resource links are not automatically downloaded.

## Connection Methods

Omnicode CLI supports three MCP server connection methods:

- **stdio**: The CLI starts the local MCP server as a child process and communicates via standard input/output. Suitable for local command-line tools.
- **HTTP**: The CLI connects to an already-running HTTP endpoint. Suitable for remote services or processes that need to run persistently.
- **SSE**: The CLI connects to a legacy HTTP+SSE endpoint (Server-Sent Events, a streaming HTTP mechanism). Prefer HTTP for new MCP servers, but use `transport: "sse"` when a service still exposes only the older SSE transport.

## Configuration

MCP server configuration is written in `mcp.json`, at two levels:

- **User level**: `~/.omnicode/mcp.json` (or `$OMNICODE_HOME/mcp.json`), shared across projects
- **Project level**: `.omnicode/mcp.json` in the working directory, effective only for the current repository

Entries with the same name: the project-level entry takes precedence and overrides the user-level entry.

Run `/mcp-config` in the TUI to interactively add, edit, or delete servers without manually editing the JSON file. Run `/mcp` to view the connection status of all current servers, to enable or disable one, and to test a connection.

The same servers can be managed from the shell with `omnicode mcp` — see [Command line](#command-line).

Deleting a server from the configuration does not interrupt open sessions: the server stays listed in `/mcp` as `removed`, its tools remain visible there, and calls to them fail with a removal notice, while new sessions do not register the tools at all. Conversely, a server added mid-session by editing `mcp.json` or installing a plugin is not registered in already-open sessions; it only joins sessions created later.

Editing a server keeps the fields you did not change. A client only ever sees the `env` and `headers` *key names* of a server, never their values, so an update that omits those maps leaves the stored values in place instead of clearing them.

When Omnicode finds project-level MCP servers in an untrusted folder, it shows each server's transport and launch target in the workspace trust prompt. The prompt defaults to `Trust this folder`; review the listed command and arguments or remote URL before confirming. Trusting the folder enables the project-level MCP servers for that workspace.

Headless runs (for example `omnicode -p` in CI) cannot show the trust prompt, so project-level MCP servers stay disabled there unless the workspace is already trusted. Set [`OMNICODE_TRUST_WORKSPACE`](../configuration/env-vars.md#runtime-switches) to `1` to trust the workspace for that process.

Structure of `mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "linear": {
      "url": "https://mcp.linear.app/mcp"
    },
    "legacy-events": {
      "transport": "sse",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

Entries with a `command` field are stdio servers; entries with a `url` field and no `transport` are HTTP servers. For legacy SSE servers, set `transport` to `"sse"` explicitly.

Optional fields:

| Field | Type | Applies to | Description |
| --- | --- | --- | --- |
| `env` | `Record<string, string>` | stdio | Environment variables injected into the child process |
| `inheritEnv` | `boolean` | stdio | Whether the server inherits the whole Omnicode environment. Defaults to `true`; set it to `false` so the server only sees the variables it needs and none of the ambient secrets. See [Environment isolation](#environment-isolation) |
| `cwd` | `string` | stdio | Working directory for the child process |
| `headers` | `Record<string, string>` | HTTP, SSE | Static request headers appended to every request |
| `bearerTokenEnvVar` | `string` | HTTP, SSE | Name of an environment variable that contains a bearer token |
| `allowPrivateNetwork` | `boolean` | HTTP, SSE | Allow an endpoint on a private or link-local address. Defaults to `false`. See [Endpoint policy](#endpoint-policy) |
| `enabled` | `boolean` | All | Set to `false` to disable this server |
| `deferred` | `boolean` | All | Experimental: set to `true` to let the model load this server's tools on demand. Defaults to `false` (always exposed inline). Prerequisites and behavior: [Loading tools on demand](#loading-tools-on-demand) |
| `startupTimeoutMs` | `number` | All | Connection timeout from `1` to `2147483647` milliseconds; default `30000` |
| `toolTimeoutMs` | `number` | All | Timeout from `1` to `2147483647` milliseconds for a single tool call; default `60000` |
| `enabledTools` | `string[]` | All | Tool allowlist |
| `disabledTools` | `string[]` | All | Tool blocklist |

You do not have to set the connection timeout or the single tool-call timeout per server: `[mcp] startup_timeout_ms` / `[mcp] tool_timeout_ms` in `config.toml` or the `OMNICODE_MCP_STARTUP_TIMEOUT_MS` / `OMNICODE_MCP_TOOL_TIMEOUT_MS` environment variables change the global defaults. Precedence is: per-server field > environment variable > `config.toml` > built-in default. See [Configuration files](../configuration/config-files.md#mcp).

HTTP and SSE servers support providing static credentials via `headers` or `bearerTokenEnvVar`. When OAuth is needed, run `/mcp-config login <server-name>` to complete browser-based authorization.

Plugins can also declare MCP servers in their manifest. Servers declared by a plugin are enabled by default and can be disabled or re-enabled in `/plugins`: disabling or removing one makes calls from open sessions fail with a removal notice, and adding or enabling a server connects it in open sessions right away. See [Plugins](./plugins.md#mcp-servers-in-plugins) for details.

::: warning Note
stdio entries in a project-level `.omnicode/mcp.json` execute local commands when a session starts. Only enable these in repositories you trust.
:::

## Loading tools on demand

By default, every tool of a server goes straight into the model's top-level tool list; with many connected servers — or a single server that exposes many tools — those definitions occupy context for the whole session. Marking a server as deferred keeps its tools out of the top-level list: the model first sees a manifest of loadable tools, loads full definitions on demand through the built-in `select_tools` tool, and can call them in the same turn once loaded.

Loading tools on demand is experimental and takes effect only when both prerequisites are met:

- The `tool-select` experimental flag is on: set `OMNICODE_EXPERIMENTAL_TOOL_SELECT=1`, or write `tool-select = true` under `[experimental]` in `config.toml`; the master switch `OMNICODE_EXPERIMENTAL_FLAG=1` enables it too.
- The current model declares the `dynamically_loaded_tools` capability: official models declare it automatically; for other models, add it to `capabilities` in `config.toml` — see [Configuration files](../configuration/config-files.md#models).

With both prerequisites met, set `deferred: true` on the server entry in `mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://mcp.example.com/mcp",
      "deferred": true
    }
  }
}
```

Servers without `deferred` are unaffected and always exposed inline; when a prerequisite is missing, the field is ignored with the same result. The authentication tool exposed by an OAuth server before authorization completes follows the same field.

## Command line

`omnicode mcp` manages the same servers as the TUI, without opening it. It is the non-interactive counterpart of `/mcp` and `/mcp-config`, and it reads and writes the same `mcp.json` files.

```sh
omnicode mcp <action> [options]
```

| Action | Description |
| --- | --- |
| `omnicode mcp list` | List the configured servers with their transport, state and source. Reads only — no server is contacted |
| `omnicode mcp status [name]` | Connect to the servers and report whether they answer. With a name, the full connection report is printed; without one, every server is probed and summarized. Exits non-zero when a probe fails |
| `omnicode mcp tools <name>` | List the tools one server advertises, from a real connection |
| `omnicode mcp inspect <name>` | Show one server: its stored configuration and its authorization state |
| `omnicode mcp add <name>` | Add a server to the user configuration |
| `omnicode mcp remove <name>` | Remove a server from the user configuration |
| `omnicode mcp enable <name>` | Enable a server without changing its configuration |
| `omnicode mcp disable <name>` | Disable a server without removing it |

Every action accepts `--json` where a machine-readable result makes sense (`list`, `status`, `tools`, `inspect`) and `--cwd <dir>` to include the project-layer servers of a directory.

### Adding a server

```sh
# A local server started as a child process
omnicode mcp add docs --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg /tmp

# A remote server over Streamable HTTP
omnicode mcp add linear --transport http --url https://mcp.linear.app/mcp

# A remote server that reads its token from the environment
omnicode mcp add github --transport http --url https://mcp.github.com/mcp --bearer-token-env GITHUB_TOKEN
```

| Option | Applies to | Description |
| --- | --- | --- |
| `--transport <transport>` | All | `stdio`, `http` or `sse`. Inferred from `--command` or `--url` when omitted |
| `--command <command>` | stdio | Command to spawn |
| `--arg <value>` | stdio | One argument. Repeatable |
| `--env <KEY=VALUE>` | stdio | One environment variable. Repeatable. Stored in plaintext in `mcp.json` |
| `--no-inherit-env` | stdio | Do not pass the Omnicode environment to the child process |
| `--cwd <dir>` | stdio | Working directory of the child process |
| `--url <url>` | HTTP, SSE | Endpoint of the server |
| `--header <KEY=VALUE>` | HTTP, SSE | One request header. Repeatable |
| `--bearer-token-env <VAR>` | HTTP, SSE | Name of the environment variable that holds the bearer token |
| `--allow-private-network` | HTTP, SSE | Allow an endpoint on a private or link-local address |
| `--tool-timeout <ms>` | All | Timeout for a single tool call, in milliseconds |
| `--disabled` | All | Add the server in the disabled state |

A stdio server is only *registered* here — nothing is executed until a session connects to it.

## Environment isolation

By default a stdio server inherits the whole Omnicode environment, which includes whatever API keys and tokens your shell happens to export. That is convenient and it is also the widest possible exposure: the server is a child process of your agent session and can read everything the agent can.

Set `inheritEnv: false` on the entry to narrow it:

```json
{
  "mcpServers": {
    "docs": {
      "command": "node",
      "args": ["./server.js"],
      "inheritEnv": false,
      "env": {
        "DOCS_ROOT": "/srv/docs"
      }
    }
  }
}
```

With `inheritEnv: false` the child process receives only the variables it needs to start — the platform basics such as `PATH`, `HOME`, `TEMP` and `TMPDIR` — plus the `env` map from the entry. Everything else, including your provider keys, is not passed on.

## Endpoint policy

Remote (HTTP and SSE) servers are reached over the network, so their endpoint is checked before a connection is made:

- Only `http` and `https` are accepted. Other schemes are rejected.
- Plain `http` is accepted for loopback addresses only (`127.0.0.0/8`, `::1`), because a local server has no transport security to offer. Everything else must use `https`.
- Private and link-local addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `fc00::/7`, `fe80::/10`) are rejected, because a configuration that points at the machine's own network is the classic way to turn a remote server into a way into the local one. Set `allowPrivateNetwork: true` to allow it deliberately — for a server that runs on your LAN, for example.
- Redirects are followed only within the same origin. A redirect to another host is refused, so an authorization header cannot be replayed to a host you did not configure.

## Tool list updates

When a server announces that its tool list changed, Omnicode re-reads it and updates the tools of that server: new tools become available, and tools the server no longer offers are removed so they cannot be called. A server that fails to answer during the refresh keeps the tools it had, so a brief outage does not take the tools away.

## Tool Naming and Permissions

MCP tools are named in the format `mcp__<server>__<tool>`, for example `mcp__github__create_issue`. Permission rules support `*` and `**` wildcards, for example `mcp__github__*` matches all tools under that server. MCP tool parameters are not included in permission matching.

Calls that do not match any permission rule trigger an approval request. Selecting "Approve for this session" in the approval dialog automatically allows subsequent calls of the same kind within the current session.

You can also pre-configure permanent rules in `[[permission.rules]]` in `config.toml`:

```toml
[[permission.rules]]
decision = "allow"
pattern = "mcp__github__*"

[[permission.rules]]
decision = "deny"
pattern = "mcp__filesystem__write_file"
```

For the full permission rule syntax, see [Configuration files](../configuration/config-files.md#permission).

## Security

When connecting to external MCP servers, be aware of:

- Only connect to servers from trusted sources
- Verify that tool names and parameters look reasonable in approval requests
- Keep manual approval for high-risk tools (file writes, command execution, etc.); avoid using `mcp__*` wildcards to allow all tools at once
- Narrow the child's environment with `inheritEnv: false` so a server cannot read your provider keys
- Check the endpoint of a remote server against the [endpoint policy](#endpoint-policy) before trusting it

A tool's own description is not proof that it is read-only. The `readOnlyHint` a server publishes is only a hint, and it is used for one narrow purpose: a call that fails on a broken connection may be repeated when the server declared the tool read-only, because repeating it cannot change anything. A call to a tool that did not declare that hint fails with a message instead of being repeated — the request may have reached the server and been executed, and repeating it could duplicate a write.

Secrets are not leaked through the surfaces that show MCP state. The `env` and `headers` values of a server are never returned to a client, only their key names are; the startup and crash messages of a server are stripped of anything that looks like a credential before they are shown; and a failed tool call reports the category of the failure rather than the raw protocol payload.

::: warning Note
In [Ask When Needed mode](../guides/interaction.md#the-three-permission-modes), MCP tool calls are automatically approved. Only use this mode when you fully trust the MCP servers you have connected.
:::

## Supported capabilities

Implemented:

- The three connection methods: stdio, Streamable HTTP, and the legacy SSE transport
- Tool discovery, validation, and invocation through the official Model Context Protocol SDK
- Per-server tool allowlists and blocklists, per-server timeouts, and deferred (on-demand) tool loading
- Tool list updates through the `tools/list_changed` notification
- Bearer-token and OAuth authorization for remote servers
- Reconnection with tool re-discovery after a connection is lost

Not implemented yet:

- **Resources** — reading a server's resources is not supported; only tools are.
- **Prompts** — a server's prompt templates are not exposed.
- **Roots** — Omnicode does not advertise a filesystem root to the server.
- **Elicitation** — a server cannot ask the user a question through the protocol.
- **Progress and log notifications** — a long-running tool call reports its result, not its progress.

These are protocol features a server may use, not requirements: a server that only offers tools works with every version above.

## Next steps

- [Plugins](./plugins.md) — Declare MCP servers in a plugin manifest to package and distribute them together
- [Configuration files](../configuration/config-files.md#permission) — Full field reference for permission rules
