# 记忆

记忆（memory）让 Omnicode 把事实、偏好和未完成的工作从一个「会话」带到下一个会话，新会话可以从项目已知的内容开始，而不是从零开始。该功能仍在实验中，默认关闭。

## 记忆会保存什么

- **任务状态**：长对话被压缩（compaction）时，目标、决策和下一步会被保存，恢复会话后可以接着做。
- **Agent 保存的事实**：Agent 主动保留的项目笔记，附带它读过的文件作为证据。
- **你明确表达的偏好**：例如提交信息该怎么写。

每条记忆都记录来源、所属项目以及可信程度。记忆是上下文，不是指令：它不能改变权限、跳过审批，也不能授予工具访问权。

## 开启记忆

为单次运行打开实验开关：

```sh
OMNICODE_EXPERIMENTAL_MEMORY=1 omnicode
```

或在 `$OMNICODE_HOME/config.toml` 中开启：

```toml
[experimental]
memory = true
```

环境变量优先于配置文件，因此 `OMNICODE_EXPERIMENTAL_MEMORY=0` 可以在不改文件的情况下为单次运行关闭记忆。

```toml
[memory]
# 第二个开关，默认开启。它和实验开关必须同时打开。
enabled = true
# 存储位置，默认 $OMNICODE_HOME/memory。
dir = "/absolute/path/to/memory"
# 单条记忆超过这个长度会被拒绝。
maxContentChars = 4000
```

## 作用域

一条记忆只在写入它的作用域内可见：

| 作用域 | 可见范围 |
|---|---|
| `global` | 本机所有项目 |
| `workspace` | 当前工作区 |
| `repository` | 当前 git 仓库 |
| `session` | 仅当前会话 |

为一个仓库保存的记忆永远不会在另一个仓库中返回；Agent 也读不到、改不了、忘不掉当前会话作用域之外的记忆。

## 信任等级

| 等级 | 含义 |
|---|---|
| `unverified` | 没有证据支撑，包括 Agent 自己保存的任何内容 |
| `trusted` | 你亲口说过，或你确认过 |
| `verified` | 引用的文件与采集时仍然一致 |
| `system` | 由应用本身持有 |

Agent 永远不能自己提升信任等级。它可以保存记忆，但在你确认或证据支持之前，这条记忆一直是 `unverified`。

基于检索的注入只呈现 `trusted` 及以上的记忆，所以未验证的笔记能被显式搜索到，但不会自己出现在对话里。

## 查看与管理记忆

```text
/memory                          列出本会话可见的记忆
/memory list <scope> <status>    按作用域和生命周期过滤
/memory show <id>                查看一条记忆的完整来源
/memory confirm <id>             把 unverified 提升为 trusted
/memory forget <id> [reason]     使一条记忆失效
/memory export [path]            把可见记忆导出为 JSON
```

作用域为 `global`、`workspace`、`repository`、`session`；状态为 `active`、`superseded`、`expired`、`invalidated`、`all`。

「忘记」是让记忆失效：记录会保留以便追溯，但不再被使用。正常流程中不会硬删除记忆。

如果一条记忆引用的文件发生变化，它会在变化被发现的当下被降级为 `unverified`，不再被注入，`/memory list` 会把它标记为 `(stale)`。用 `/memory show <id>` 可以看到是哪个引用变了。

网页端通过 `/api/v1/memory` 读取同一份数据，见 [Server API](../reference/server-api.md)。

## 记忆存放在哪里

存储默认位于 `$OMNICODE_HOME/memory/`；可以用 `[memory]` 段的 `dir` 或 `OMNICODE_MEMORY_DIR` 改变位置。同一时间只允许一个进程写入。第二个 Omnicode 实例打开同一个存储时可以正常读取，但会拒绝写入，而不是写坏数据。

## 记忆不做什么

- 不做嵌入或向量化。检索是词法匹配，只带轻量词干还原和一张面向编程术语的小型同义词表。
- 不允许 Agent 批准自己的记忆、修改自己的信任等级或扩大自己的作用域。
- 不用模型做摘要。后台队列只执行确定性规则。
