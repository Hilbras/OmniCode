# Model Context Protocol

[Model Context Protocol（MCP）](https://modelcontextprotocol.io/) 是一个开放协议，让模型可以安全地调用外部进程或服务暴露的工具：读取 GitHub issues、查询数据库、操作本地文件系统。Omnicode CLI 作为 MCP client 接入这些外部工具，把它们与内置工具一起暴露给 Agent 使用，行为上没有差异。

MCP 工具结果可以包含文本（`content`）和结构化数据（`structuredContent`）。Omnicode CLI 会将两者提供给 Agent，只有能够确认某个文本块已包含同一份完整 JSON 值时，才省略重复的结构化内容。文本摘要和媒体不会替代结构化记录。

Omnicode CLI 会保留因格式或大小限制而无法直接交付的内嵌 MCP 附件。内嵌图片、音频和视频即使能够原样交付也会保存，因为后续供应商协议转换或历史精简可能省略它们。模型支持相应内容时，即使工作区文件系统不可用，也仍可读取会话附件。原件随会话保存在媒体存储中，不会被图片缓存淘汰。保存的原件（包括图片压缩前的原图）均提供绝对路径和稳定的 `omnicode-file://` 引用。将引用作为 `path` 传给 `Read` 或 `ReadMediaFile`，即使工作区 runtime 无法访问会话存储，也能直接从当前会话存储读取字节。分页续读会保留该引用，包括 fork 后的会话。对于 `Read` 无法打开的二进制格式，错误信息会在可用时提供服务端本地路径；外部转换工具必须能够访问该文件系统。CSV、HTML、JSON 和普通 SVG 等文本附件使用可读取的扩展名。

附件路径和压缩说明共用工具输出预算。较长的清单会保存为文本文件，结果中保留简短指针，即使伴随的文本被截短，该指针仍然可见；Agent 可将清单的 `omnicode-file://` 引用传给 `Read`，分页读取完整内容。取消工具调用会停止后续附件处理，并通知正在进行的写入操作。如果解码或保存失败，结果会明确说明原件未能保留，并保留其他可用输出。资源链接不会被自动下载。

## 接入方式

Omnicode CLI 支持三种 MCP server 接入方式：

- **stdio**：CLI 以子进程方式启动本地 MCP server，通过标准输入输出通信。适合本地命令行工具。
- **HTTP**：CLI 连接一个已在运行的 HTTP 端点。适合远程服务或需要持久运行的进程。
- **SSE**：CLI 连接旧式 HTTP+SSE 端点。新 MCP server 优先使用 HTTP；只有服务仍仅暴露旧式 SSE 传输时，才设置 `transport: "sse"`。

## 配置

MCP server 配置写在 `mcp.json` 中，分两层：

- **用户级**：`~/.omnicode/mcp.json`（或 `$OMNICODE_HOME/mcp.json`），跨项目共享
- **项目级**：工作目录下的 `.omnicode/mcp.json`，只对当前仓库生效

同名条目以项目级为准，覆盖用户级。

在 TUI 中运行 `/mcp-config` 可以交互式地新增、编辑或删除 server，无需手动编辑 JSON 文件。运行 `/mcp` 可查看当前所有 server 的连接状态，也可以启用、禁用某个 server 或测试连接。

同一批 server 也可以在终端中用 `omnicode mcp` 管理，详见 [命令行](#命令行)。

从配置中删除某个 server 不会打断进行中的会话：该 server 在 `/mcp` 中仍显示为 `removed`，其工具在这些会话中保持可见，但调用会失败并返回移除提示；新会话则完全不会注册这些工具。反过来，编辑 `mcp.json` 或安装 plugin 新增的 server 也不会注册到已打开的会话，只会加入之后创建的会话。

编辑某个 server 时，未改动的字段会保留。客户端只能看到 server 的 `env` 与 `headers` 的**键名**，看不到对应的值，因此没有携带这两张表的更新不会清空已保存的值。

当 Omnicode 在不受信任的文件夹中发现项目级 MCP server 时，工作区信任提示会显示每个 server 的传输方式和启动目标。提示默认选中 `Trust this folder`；核对列出的命令与参数或远程 URL 后确认即可，选择 `Don't trust` 则该工作区的项目级 MCP server 不会启用。

无头运行（例如在 CI 中执行 `omnicode -p`）无法显示信任提示，因此在工作区尚未受信任时，项目级 MCP server 会保持禁用。将 [`OMNICODE_TRUST_WORKSPACE`](../configuration/env-vars.md#运行时开关) 设为 `1` 即可在该进程中信任当前工作区。

`mcp.json` 的结构：

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

含 `command` 字段的条目为 stdio server；含 `url` 字段且未写 `transport` 的条目为 HTTP server。旧式 SSE server 需要显式把 `transport` 设为 `"sse"`。

可选字段：

| 字段 | 类型 | 适用方式 | 说明 |
| --- | --- | --- | --- |
| `env` | `Record<string, string>` | stdio | 注入子进程的环境变量 |
| `inheritEnv` | `boolean` | stdio | 该 server 是否继承 Omnicode 的整个环境，默认 `true`；设为 `false` 时它只能看到自己需要的变量，看不到环境中的任何密钥。详见 [环境隔离](#环境隔离) |
| `cwd` | `string` | stdio | 子进程工作目录 |
| `headers` | `Record<string, string>` | HTTP、SSE | 附加到每次请求的静态请求头 |
| `bearerTokenEnvVar` | `string` | HTTP、SSE | 存放 bearer token 的环境变量名 |
| `allowPrivateNetwork` | `boolean` | HTTP、SSE | 允许指向内网或链路本地地址的端点，默认 `false`。详见 [端点策略](#端点策略) |
| `enabled` | `boolean` | 全部 | 设为 `false` 可禁用该 server |
| `deferred` | `boolean` | 全部 | 实验功能：设为 `true` 时该 server 的工具由模型按需加载，默认 `false`（始终直接暴露）。前提与行为见 [按需加载工具](#按需加载工具) |
| `startupTimeoutMs` | `number` | 全部 | 连接超时，取值范围为 `1` 到 `2147483647` 毫秒，默认 `30000` |
| `toolTimeoutMs` | `number` | 全部 | 单次工具调用超时，取值范围为 `1` 到 `2147483647` 毫秒，默认 `60000` |
| `enabledTools` | `string[]` | 全部 | 工具白名单 |
| `disabledTools` | `string[]` | 全部 | 工具黑名单 |

连接超时和单次工具调用超时的默认值都不必逐个 server 设置：`config.toml` 的 `[mcp] startup_timeout_ms` / `[mcp] tool_timeout_ms` 或环境变量 `OMNICODE_MCP_STARTUP_TIMEOUT_MS` / `OMNICODE_MCP_TOOL_TIMEOUT_MS` 可以调整全局默认值，优先级为 server 字段 > 环境变量 > `config.toml` > 内置默认。详见 [配置文件](../configuration/config-files.md#mcp)。

HTTP 与 SSE server 支持通过 `headers` 或 `bearerTokenEnvVar` 提供静态凭证。需要 OAuth 时，运行 `/mcp-config login <server-name>` 完成浏览器授权。

Plugins 也可以在 manifest 中声明 MCP servers。Plugin 声明的 servers 默认启用，可以在 `/plugins` 中禁用或重新启用：禁用或移除后，已打开会话中的工具调用会失败并返回移除提示；新增或启用 server 会立即连接到已打开的会话。详见 [Plugins](./plugins.md#plugin-中的-mcp-servers)。

::: warning 注意
项目级 `.omnicode/mcp.json` 中的 stdio 条目会在会话启动时执行本地命令，只在你信任的仓库里启用。
:::

## 按需加载工具

默认情况下，server 的所有工具都会直接进入模型的顶层工具列表；接入的 server 较多、或单个 server 暴露的工具较多时，这些工具定义会持续占用上下文。把 server 标记为 deferred 后，它的工具不再进入顶层工具列表：模型先看到一份可加载工具清单，需要时通过内置的 `select_tools` 工具加载完整定义，加载后同一轮即可调用。

按需加载是实验功能，同时满足两个前提才会生效：

- 启用 `tool-select` 实验标志：设置环境变量 `OMNICODE_EXPERIMENTAL_TOOL_SELECT=1`，或在 `config.toml` 的 `[experimental]` 下写 `tool-select = true`；总开关 `OMNICODE_EXPERIMENTAL_FLAG=1` 会一并启用。
- 当前模型声明了 `dynamically_loaded_tools` 能力：官方模型自动声明；其他模型可在 `config.toml` 的 `capabilities` 中追加，见 [配置文件](../configuration/config-files.md#models)。

满足前提后，在 `mcp.json` 的 server 条目里设 `deferred: true`：

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

未设置 `deferred` 的 server 不受影响，工具始终直接暴露；前提不满足时该字段被忽略，行为相同。需要 OAuth 授权的 server 在完成授权前暴露的认证工具也遵循这个字段。

## 命令行

`omnicode mcp` 管理的是与 TUI 相同的一批 server，无需打开 TUI。它是 `/mcp` 与 `/mcp-config` 的非交互版本，读取和写入的是同一批 `mcp.json` 文件。

```sh
omnicode mcp <action> [options]
```

| 操作 | 说明 |
| --- | --- |
| `omnicode mcp list` | 列出已配置的 server，含传输方式、状态与来源。只读取，不连接任何 server |
| `omnicode mcp status [name]` | 连接 server 并报告是否响应。带名字时打印完整的连接报告；不带名字时逐个探测并汇总。探测失败时以非零状态码退出 |
| `omnicode mcp tools <name>` | 通过一次真实连接列出某个 server 提供的工具 |
| `omnicode mcp inspect <name>` | 查看某个 server：已保存的配置与授权状态 |
| `omnicode mcp add <name>` | 向用户级配置新增一个 server |
| `omnicode mcp remove <name>` | 从用户级配置删除一个 server |
| `omnicode mcp enable <name>` | 启用某个 server，不改动它的配置 |
| `omnicode mcp disable <name>` | 禁用某个 server，但不删除它 |

需要机器可读结果的操作（`list`、`status`、`tools`、`inspect`）都支持 `--json`；所有操作都支持 `--cwd <dir>`，用于把某个目录的项目级 server 一并纳入。

### 新增 server

```sh
# 以子进程方式运行的本地 server
omnicode mcp add docs --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg /tmp

# 通过 Streamable HTTP 接入的远程 server
omnicode mcp add linear --transport http --url https://mcp.linear.app/mcp

# 从环境变量读取 token 的远程 server
omnicode mcp add github --transport http --url https://mcp.github.com/mcp --bearer-token-env GITHUB_TOKEN
```

| 选项 | 适用方式 | 说明 |
| --- | --- | --- |
| `--transport <transport>` | 全部 | `stdio`、`http` 或 `sse`。省略时根据 `--command` 或 `--url` 推断 |
| `--command <command>` | stdio | 要启动的命令 |
| `--arg <value>` | stdio | 一个参数，可重复 |
| `--env <KEY=VALUE>` | stdio | 一个环境变量，可重复。以明文保存在 `mcp.json` 中 |
| `--no-inherit-env` | stdio | 不把 Omnicode 的环境传给子进程 |
| `--cwd <dir>` | stdio | 子进程工作目录 |
| `--url <url>` | HTTP、SSE | server 端点 |
| `--header <KEY=VALUE>` | HTTP、SSE | 一个请求头，可重复 |
| `--bearer-token-env <VAR>` | HTTP、SSE | 存放 bearer token 的环境变量名 |
| `--allow-private-network` | HTTP、SSE | 允许指向内网或链路本地地址的端点 |
| `--tool-timeout <ms>` | 全部 | 单次工具调用超时，单位毫秒 |
| `--disabled` | 全部 | 以禁用状态新增该 server |

stdio server 在这里只是被**登记**，不会执行任何命令；只有会话真正连接时才会启动它。

## 环境隔离

默认情况下，stdio server 会继承 Omnicode 的整个环境，其中包括你的 shell 恰好导出的各种 API key 和 token。这很方便，但也意味着最大的暴露面：server 是 Agent 会话的子进程，能读到的一切 Agent 都能读到。

把条目的 `inheritEnv` 设为 `false` 即可收窄：

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

`inheritEnv: false` 时，子进程只会拿到启动所必需的基础变量（例如 `PATH`、`HOME`、`TEMP`、`TMPDIR`），再加上条目里的 `env` 映射。其余变量，包括各家供应商的密钥，都不会传过去。

## 端点策略

远程（HTTP 与 SSE）server 走网络，因此连接前会先检查端点：

- 只接受 `http` 与 `https`，其余协议一律拒绝。
- 明文 `http` 只对回环地址开放（`127.0.0.0/8`、`::1`），因为本地 server 本来就没有传输安全可言；其他地址必须使用 `https`。
- 内网与链路本地地址（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`100.64.0.0/10`、`fc00::/7`、`fe80::/10`）默认拒绝：把远程 server 指向本机网络，是把远程能力变成内网入口的常见做法。确有必要时可显式设置 `allowPrivateNetwork: true`，例如 server 就跑在你的局域网里。
- 重定向只跟随同源跳转。跳转到其他主机的重定向会被拒绝，授权头因此不会被转发到你没有配置过的主机。

## 工具列表更新

当 server 声明自己的工具列表发生变化时，Omnicode 会重新读取并更新该 server 的工具：新增的工具立即可用，server 不再提供的工具会被移除，因此无法再被调用。刷新时如果 server 没有响应，会保留原有的工具列表，短暂的故障不会让工具凭空消失。

## 工具命名与权限

MCP 工具按 `mcp__<server>__<tool>` 格式命名，例如 `mcp__github__create_issue`。权限规则中支持 `*` 和 `**` 通配，例如 `mcp__github__*` 命中该 server 下所有工具。MCP 工具参数不参与权限匹配。

未命中权限规则的调用会触发审批请求；在审批弹窗中选择“Approve for this session”后，本次会话内的后续同类调用自动放行。

也可以在 `config.toml` 的 `[[permission.rules]]` 中预置永久规则：

```toml
[[permission.rules]]
decision = "allow"
pattern = "mcp__github__*"

[[permission.rules]]
decision = "deny"
pattern = "mcp__filesystem__write_file"
```

权限规则的完整语法见 [配置文件](../configuration/config-files.md#permission)。

## 安全性

接入外部 MCP server 时需注意：

- 只接入可信来源的 server
- 在审批请求中核查工具名与参数是否合理
- 对高风险工具（写文件、执行命令等）维持手动审批，避免用 `mcp__*` 通配放行全部工具
- 用 `inheritEnv: false` 收窄子进程的环境，避免 server 读到你的供应商密钥
- 信任远程 server 之前，先按 [端点策略](#端点策略)核对它的端点

工具自己写的说明并不能证明它只读。server 发布的 `readOnlyHint` 只是一个提示，它只用于一个很窄的场景：连接中断导致的失败，只有在 server 声明该工具只读时才会重试，因为重试不可能改变任何状态。没有该提示的调用失败后直接报错，不会自动重试——请求可能已经到达并被执行过，重试可能造成重复写入。

展示 MCP 状态的各个界面不会泄露密钥。server 的 `env` 与 `headers` 的值不会返回给客户端，只返回键名；server 的启动与崩溃信息在展示前会先去掉看起来像凭证的内容；失败的工具调用只报告失败类别，而不是原始协议报文。

::: warning 注意
在 [YOLO 模式](../guides/interaction.md#三种权限模式)下，MCP 工具调用会被自动批准。仅在完全信任所接入的 MCP server 时使用此模式。
:::

## 已支持的能力

已实现：

- 三种接入方式：stdio、Streamable HTTP，以及旧式 SSE 传输
- 通过官方 Model Context Protocol SDK 完成工具发现、校验与调用
- 按 server 配置的工具白名单与黑名单、按 server 配置的超时，以及按需（deferred）加载工具
- 通过 `tools/list_changed` 通知同步工具列表
- 远程 server 的 bearer token 与 OAuth 授权
- 连接断开后的重连与工具重新发现

尚未实现：

- **Resources**——暂不支持读取 server 的资源，只支持工具。
- **Prompts**——server 提供的 prompt 模板不会暴露出来。
- **Roots**——Omnicode 不会向 server 声明文件系统根目录。
- **Elicitation**——server 无法通过协议向用户提问。
- **进度与日志通知**——长时间运行的工具调用只返回结果，不汇报进度。

这些都是 server 可以选用、而不是必须提供的协议能力：只提供工具的 server 在上述所有版本中都能正常工作。

## 下一步

- [Plugins](./plugins.md) — 在 plugin manifest 中声明 MCP server，一键打包和分发
- [配置文件](../configuration/config-files.md#permission) — 权限规则的完整字段参考
