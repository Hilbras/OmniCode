# 从 V3 迁移到 V4

Omnicode CLI V4 引入了可组合的供应商架构。在 V3 中，供应商是一个单一的不透明单元：一个 API 协议、一种认证方式和一个模型列表。在 V4 中，供应商由三个独立的部分组合而成——API 适配器、认证策略和模型定义——这三者可以自由混合搭配。

本页面说明现有的 V3 供应商配置如何在 V4 中继续工作、你可能会看到哪些变化，以及如何更新已弃用的设置。

## V4 中的变化

- **认证与 API 协议相互独立。** 供应商可以使用任意 API 适配器搭配任意认证策略，包括以前不可能实现的组合。
- **凭证与供应商定义分开存储。** 原始密钥不再直接写入供应商配置文件中。
- **模型发现与供应商无关。** 发现通过共享流水线运行，对来自任意 API 适配器的结果进行标准化和校验。
- **新增 `omnicode auth` 命令**，用于管理支持该功能的供应商的认证状态。

现有的 V3 供应商无需任何操作即可继续工作。你的配置会被读取，并在下次启动时自动转换为 V4 格式。

## 自动迁移

首次运行 V4 时，CLI 会检测到任何 V3 供应商配置，并原地将其迁移。你会看到类似以下的提示：

```text
警告：
此配置使用 V3 认证格式。
它将被迁移到 V4 认证系统。
```

迁移是自动且安全的。它绝不会删除你的旧配置；而是会在旁边写入一份新的 V4 配置。你可以通过 `omnicode provider list` 查看结果，如果需要，也可以通过恢复之前的文件来回滚。

## 迁移内容

| V3 设置 | V4 等效项 |
| --- | --- |
| `providers.<id>.api_key` | `providers.<id>.auth.type = "api-key"`，并使用凭证引用 |
| `providers.<id>.base_url` | `providers.<id>.api.baseUrl` |
| `providers.<id>.protocol` | `providers.<id>.api.adapter` |
| `providers.<id>.models` | `providers.<id>.models.override` |
| `providers.<id>.env` | `providers.<id>.auth.credential`（环境变量） |

## 手动供应商

`omnicode provider add-manual` 在 V4 中继续可用。交互式问题现在覆盖了新架构：

```text
供应商 ID: my-gateway
名称: My Gateway
基础 URL: https://example.com/v1
协议: OpenAI
认证: API 密钥
凭证: 环境变量
模型发现: 已启用
```

## 已弃用的字段

以下 V3 字段在 V4 中已弃用，并将在未来的主版本中移除。它们仍然有效，但新配置应使用 V4 等效项。

- `providers.<id>.api_key` — 改用 `providers.<id>.auth`
- `providers.<id>.api_key_env` — 改用 `providers.<id>.auth.credential`
- `providers.<id>.protocol` — 改用 `providers.<id>.api.adapter`

## 向后兼容

所有现有命令继续有效：

```sh
omnicode provider list
omnicode provider add
omnicode provider add-manual
omnicode provider add-builtin
omnicode provider edit
omnicode provider remove
```

新命令扩展了现有命令，而非取代它们：

```sh
omnicode auth list
omnicode auth status
omnicode auth login <provider>
omnicode auth logout <provider>
omnicode auth refresh <provider>
omnicode provider auth <id>
omnicode provider models <id>
omnicode provider test <id>
```

## 故障排除

**某个在 V3 中正常工作的供应商在 V4 中无法认证。**
请检查你的凭证来源是否仍已配置。在 V3 中，API 密钥是内联存储的；在 V4 中，它通过环境变量、凭证存储或交互式认证进行解析。运行 `omnicode auth status <provider>` 查看当前状态。

**模型发现未返回任何模型。**
V4 的发现是尽力而为的。如果发现失败，供应商仍然会被保存，你可以使用 `omnicode provider models <id>` 手动配置模型。

**自定义请求头未被发送。**
自定义请求头现在位于 `providers.<id>.api.defaultHeaders` 下，而不是供应商的顶层配置中。

## 后续步骤

- [供应商与模型](../configuration/providers.md) — 配置 API 适配器和认证策略
- [认证与凭证](../configuration/authentication.md) — 安全地管理凭证
- [配置文件](../configuration/config-files.md) — `config.toml` 的完整参考