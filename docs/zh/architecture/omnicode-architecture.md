# OmniCode-V 架构与工作流

状态：active  
范围：仓库级架构，以及 `docs/plans/qwen-parity-improvement-plan.md` 中七个工作流的实现状态。  
事实来源：本英文文档。中文镜像为 `docs/zh/architecture/omnicode-architecture.md`。两者不一致时，以英文文档为准并完成对齐。

相关文档：

- [端到端测试计划](../quality/e2e-test-plan.md)
- [记忆召回评估基线](../quality/memory-recall-evaluation.md)
- [Qwen 对齐改进计划](../../plans/qwen-parity-improvement-plan.md)

## 分层模型

内核是一个 TypeScript ESM monorepo。包边界由 `scripts/check-kernel-layering.mjs` 强制执行；任何 import 变更后运行 `pnpm check:architecture`。

叶子包是 `base`、`auth`、`kaos`、`llm`、`minidb`、`telemetry`、`transcript`、`tree-sitter-bash` 和 `tui`。叶子包不得 import 其他 `@hilbras/omnicode-*` 包。

| 包 | 允许 import |
|---|---|
| `rpc` | `base` |
| `engine` | 叶子包 |
| `core` | `base` 和 `engine` |
| `sdk` | 除 `api` 外的任意包 |
| `api` | 除 `server` 和 `acp` 外的任意包 |
| 其他包 | 不得 import `server` |
| 除 `api` 外的所有包 | 不得 import `acp` |

`packages/core` 是 `packages/base` 加 `packages/engine` 的门面，不是自成一套的依赖注入引擎。

CLI 通过 `@hilbras/omnicode-api` 连接，该包重导出 SDK。CLI 不得 import engine 内部实现。可视化应用是唯一的只读例外：它读取磁盘上的会话产物以及特定的 engine wire/context 辅助函数。不要扩大该例外，也不要把它复制到 CLI。

## 运行时接缝

### Feature

Feature 注册是 import 时发生的副作用。`registerFeature()` 追加到模块级数组，因此只有模块在组合根被 import 时 feature 才生效。一个 feature 可以贡献 service、tool、command、config section、agent/session model 和 profile。

接缝位于 `packages/engine/src/features/feature.ts` 和 `packages/engine/src/features/featureRegistry.ts`。常见的隐藏缺陷是静默未注册：代码已经存在，但没有 import 把它拉进来，运行时完全不可见。

### Tool

内置工具位于 `packages/Tools/src/`，通过 `packages/Tools/src/index.ts` 中的副作用 import 激活。工具只有同时被 `packages/engine/src/session/agentLifecycle/profile/profiles.ts` 中的活动 profile 接纳，才对模型可见。

审批是独立的一层。只读且确实安全的工具可以加入 `packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`；有副作用的工具必须有明确的安全论证。

### 会话与状态

会话和 agent 状态以 `Event2` 类进行事件溯源。持久事件声明静态 type、durable 标记和 zod schema；状态从 `wire.jsonl` 重放。修改事件、配置或状态形状必须重新生成所属 manifest。生成文件不得手工编辑。

### 记忆信任

记忆记录携带 provenance、trust、sensitivity、retention、lifecycle 和 legal hold 状态。各表面必须保持以下不变量：

- 模型写入的记忆不能超过 `unverified`。
- 自动注入只接受可信记忆；显式搜索可以包含未验证记忆，但必须标注。
- `secret` 记忆永不进入 provider。
- Legal hold 阻止破坏性变更，不阻止读取。
- 破坏性变更写入历史前镜像。
- 检索必须如实报告结果是完整还是部分。

修改记忆行为前先阅读 `packages/memory/AGENTS.md`。

## 交付流水线

`pnpm check:guards` 运行 workspace glob 检查、内核分层检查、无注释区和 agent 文档一致性检查。它是交接前的默认门禁。

`node scripts/preflight.mjs` 封装本地门禁：workspace 与 guard 检查，engine、memory、CLI 的包级 typecheck，随后是权限策略和记忆生命周期的针对性测试。`--dry-run` 只打印步骤不执行；`--skip-typecheck` 和 `--skip-tests` 用于迭代时缩小范围。等价的根脚本是 `pnpm preflight`。

`.github/workflows/ci.yml` 在 pull request 和推送到 `main` 时运行相同的 guard 与针对性测试面。它使用 `pnpm install --frozen-lockfile` 安装，使用 pnpm store 缓存，并声明 `contents: read` 权限。它有意不运行完整 Turbo 测试图、构建或发布步骤。

## 工作流状态

| 工作流 | 当前树内状态 | 证据与剩余工作 |
|---|---|---|
| 1. 权限 auto 模式 | 已实现 | `policies/auto-mode-classifier.ts`、`denialTracking.ts`、危险命令升级、可信用户回答和 MCP 歧义处理已接入策略链。测试位于 `packages/engine/test/agent/permissionPolicy/`。 |
| 2. 记忆生命周期 | 核心已实现 | 自动捕获与晋升已存在于 `packages/memory/src/layers/` 和 `service/memoryService.ts`；dream consolidation 与 relevance selector 位于 `service/` 和 `retrieval/`；`tool/memoryManageTool.ts` 暴露管理动作。频道作用域存储使用 `channel` scope 层。 |
| 3. 频道平台 | 核心已实现 | `packages/channels/` 包含 contract、registry、会话绑定、生命周期命令,以及 Telegram 和基于 webhook 的 DingTalk、WeChat、Feishu、Slack 适配器,测试位于 `packages/channels/test/`。频道记忆使用 `channel` scope 层。Discord 与自动化跨进程 E2E 仍暂缓。 |
| 4. 工具扩展 | 已实现 | `packages/Tools/src/` 现有 `code-intelligence/lsp`、`git-worktree`、`notebook`、`tasks`、`teams`、`records`(artifact 与 source)和 `diagnostics`。注册位于 `packages/Tools/src/index.ts`;profile 和默认/自动审批已包含新工具,会变更文件或 worktree 的工具不进入自动批准。 |
| 5. Team、arena、budget | 已实现 | `packages/engine/src/agent/team/` 包含 team service、arena、workflow budget、task notification queue、forked-agent cache 和已注册的 `Team` 工具,并有测试。team 专项测试通过。 |
| 6. OS 级沙箱 | 核心已实现 | `packages/Kaos/src/sandbox/` 包含 bwrap 执行、shell 策略、路径策略、选择、可用性探测和 file worker,并有测试。landlock 后端会报告纯 TypeScript 无法执行强制隔离,并显式回退,不伪装成已隔离。 |
| 7. 交付、文档、评估 | 已实现，含一项延期 | 本次变更新增 CI workflow、preflight 脚本、双语架构与质量文档、E2E 计划和召回评估基线。Lint 边界与文件名规则延期，见下文。 |

工作流 3 到 6 已实现,其所属包的专项测试通过。跨进程自动化 E2E 仍暂缓; [E2E 测试计划](../quality/e2e-test-plan.md) 记录预期用例和手动/自动化边界。

## 延期的 lint 强制

包边界和文件名 lint 规则尚未启用。延期是刻意的：

- 仓库没有 ESLint 配置文件，也没有任何包的 `lint` 脚本。
- 根 `pnpm lint` 调用 `turbo run lint`，当前不匹配任何包任务，是空操作。
- `.oxlintrc.json` 存在，但 `oxlint` 不是依赖，也没有安装二进制。该文件还引用了 `packages/omnicode-minidb`、`packages/omnicode-server` 等本树中不存在的历史路径。

现在添加规则需要新增依赖并修复一份无关的陈旧配置，而且规则无法验证。Lint 恢复后，延期的规则是：与内核分层表一致的 no-restricted-import 规则，以及包源码文件的文件名约定规则。在此期间，内核分层仍由 `scripts/check-kernel-layering.mjs` 强制。

## 验证

```bash
pnpm check:guards
node scripts/preflight.mjs --dry-run
pnpm --filter @hilbras/omnicode-engine typecheck
pnpm --filter @hilbras/omnicode-memory typecheck
pnpm --filter @omnicode/cli typecheck
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy
pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts test/dreamConsolidation.test.ts test/relevanceSelector.test.ts
```

迭代时运行窄命令，交接前运行 `pnpm preflight`。不要从本文档报告 CI 结果；只有 workflow 实际运行才能报告。
