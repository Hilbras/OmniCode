# 端到端测试计划

状态：active  
范围：`docs/plans/qwen-parity-improvement-plan.md` 中七个工作流的跨表面行为。本计划覆盖权限 auto 模式、记忆 dream consolidation、频道、工具、team/arena/budget 和沙箱。  
事实来源：本英文文档。中文镜像为 `docs/zh/quality/e2e-test-plan.md`。两者不一致时以英文文档为准完成对齐。

相关文档：

- [架构与工作流状态](../architecture/omnicode-architecture.md)
- [记忆召回评估基线](memory-recall-evaluation.md)

## 如何运行

没有单一端到端套件覆盖所有工作流。使用能观察到该行为的最窄层级：

```bash
pnpm check:guards
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy
pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts test/dreamConsolidation.test.ts test/relevanceSelector.test.ts
```

CLI 端到端测试有环境门禁，不属于默认运行：

```bash
OMNICODE_E2E=1 pnpm --filter @omnicode/cli exec vitest run test/e2e
OMNICODE_E2E_REAL=1 pnpm --filter @omnicode/cli exec vitest run test/e2e/real-llm-smoke.e2e.test.ts
```

Provider 测试使用录制的 HTTP cassette。录制需显式开启 `OMNICODE_CASSETTE_RECORD=1`，不得在 CI 中开启。

不要用 sleep 或 timeout 同步用例。等待明确信号：渲染状态、审批提示、持久事件或进程退出。

## 状态总览

| 领域 | 可用测试层 | 本计划中的用例 |
|---|---|---|
| 权限 auto 模式 | 自动化策略测试；CLI 手工检查 | 就绪 |
| 记忆 dream consolidation | 自动化记忆测试；`memory_manage` 手工检查 | 就绪 |
| 频道 | `packages/channels/test/` | 专项测试通过;自动化 E2E 暂缓 |
| 工具 | `packages/Tools/test/` | 专项测试通过;自动化 E2E 暂缓 |
| Team、arena、budget | `packages/engine/test/agent/team/` | 专项测试通过;自动化 E2E 暂缓 |
| OS 沙箱 | `packages/Kaos/test/sandbox/` | 专项测试通过;自动化 E2E 暂缓 |

没有完成模块的领域不得报告为通过。标记为进行中或阻塞，并注明失败的包检查。

## 1. 权限 auto 模式

### 自动化覆盖

`packages/engine/test/agent/permissionPolicy/permissionPolicyService.test.ts` 覆盖策略链。`denialTracking.test.ts` 覆盖升级状态。

```bash
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/permissionPolicy
```

### 用例

| 用例 | 步骤 | 预期 |
|---|---|---|
| 安全只读工具被批准 | 将策略置于 `auto` 模式，请求 `memory_search` 或文件读取等只读工具 | 无提示直接批准；审批记录使用分类类别，不包含原始命令 |
| 变更类工具询问 | 请求工作区内写入或编辑 | 出现审批提示；分类器不得静默批准 |
| 危险命令询问 | 请求递归删除等破坏性 shell 命令 | 危险命令策略先于分类器运行并要求确认 |
| 重复拒绝触发升级 | 在 `auto` 模式下多次拒绝同一请求 | denial tracking 暴露升级，而不是无限重复相同提示 |
| 模式切换重置拒绝状态 | 触发拒绝，切到 `manual`，再切回 `auto` | 拒绝计数随策略实例/模式变化重置 |
| 可信用户回答生效 | 用可信回答响应审批问题 | 分类器批准对应动作，不再二次提示 |
| MCP 工具歧义询问 | 请求授权歧义或私有/link-local 的 MCP 工具 | 按策略拒绝或升级，绝不自动批准 |
| 遥测脱敏 | 在开启遥测的情况下执行上述用例 | 事件只包含安全类别；不含原始命令、路径、环境值、token 或错误正文 |

### CLI 手工验证

1. 使用一次性 `OMNICODE_HOME` 启动 CLI。
2. 切换到 `auto` 模式。
3. 分别触发只读操作、工作区写入和破坏性 shell 命令。
4. 重复拒绝同一提示，确认升级可见。
5. 检查遥测输出，确认没有原始命令或密钥泄漏。

## 2. 记忆 dream consolidation

### 自动化覆盖

`packages/memory/test/dreamConsolidation.test.ts` 覆盖 service 方法；`tool.test.ts` 与 `memoryManageTool` 覆盖工具表面。

```bash
pnpm --filter @hilbras/omnicode-memory exec vitest run test/dreamConsolidation.test.ts test/tool.test.ts
```

### 用例

| 用例 | 步骤 | 预期 |
|---|---|---|
| 合并相关 working 记忆 | 在同一 subject 和 scope 下捕获至少两条 `working` 记忆，然后调用 `dreamConsolidate(scope)` | 生成一条 `distilled` 记录，`origin: application`、`sourceType: derived`，evidence 指向所有来源 |
| 取代来源 | 合并后检查来源记录 | 来源被 supersede；搜索只返回合并记录，不返回两条 |
| 跳过 legal hold | 对一条来源施加 legal hold 后合并 | 被 hold 的来源保持不变且不参与合并；操作报告跳过内容 |
| 无候选 | 对空 scope 执行合并 | 状态 completed，consolidated 和 superseded 均为零；不得写入空记录 |
| 作用域隔离 | 合并项目 A，同时项目 B 存在相同 subject | 只有项目 A 变化；项目 B 不受影响 |
| Secret 边界 | scope 内包含 `secret` 记录 | secret 不出现在合并内容、evidence 摘要、工具输出或发往 provider 的上下文中 |
| 工具一致性 | 调用 `memory_manage` 的 `dream` 或 `consolidate` | 输出与 service 结果一致，给出合并 id，但不暴露记录正文 |

### CLI 手工验证

1. 在一个项目内捕获两条相同 subject 的事实。
2. 运行记忆管理命令的 dream 动作。
3. 搜索该 subject，确认只有一条 distilled 结果。
4. 确认被 legal hold 的来源被跳过且仍可读。

## 3. 频道

状态：核心已实现。`packages/channels/` 包含 contract、registry、会话绑定、生命周期命令,以及 Telegram 和基于 webhook 的 DingTalk、WeChat、Feishu、Slack 适配器。自动化覆盖位于 `packages/channels/test/`。Discord 和自动化跨进程 E2E 仍暂缓。运行适配器测试:

```bash
pnpm --filter @hilbras/omnicode-channels test
```

计划用例：

| 用例 | 预期 |
|---|---|
| 一个 contract，多适配器 | Telegram 加至少两个 DingTalk、WeChat、Feishu、Slack、Discord 适配器通过同一基础 contract 工作 |
| 入站消息绑定会话 | 频道对话映射到持久 OmniCode 会话；重启适配器后恢复绑定 |
| 出站投递 | agent 输出只投递一次，重试不得产生重复消息 |
| 频道作用域记忆 | 频道写入的记忆限定在该频道和项目；其他频道无法检索 |
| 信任与敏感度 | 不可信频道记忆必须标注且不得自动注入；`secret` 记忆永不离开主机 |
| 适配器失败显式化 | 缺少凭证、网络失败和畸形 payload 给出可操作错误；不得静默丢弃 |
| 生命周期命令 | 频道启动、停止、状态和登出可用，且不遗留孤儿会话 |

自动化应包括适配器测试和每个适配器一个集成冒烟测试。套件不得在 CI 中依赖真实外部凭证。

## 4. 工具

状态：已实现。`packages/Tools/src/` 现有 `code-intelligence/lsp`、`git-worktree`、`notebook`、`tasks`、`teams`、`records`(artifact 与 source)和 `diagnostics`,并在 `packages/Tools/src/index.ts` 注册。profile 和审批策略已包含新工具。运行工具测试:

```bash
pnpm --filter @hilbras/omnicode-tools test
```

计划用例：

| 用例 | 预期 |
|---|---|
| Profile 可见性 | 每个新工具都注册于 `packages/Tools/src/index.ts` 并被活动 profile 接纳；未列入的工具对模型不可见 |
| LSP 只读行为 | 符号查找和诊断只读；仅在确实安全时默认批准 |
| Worktree 生命周期 | 创建、列出、删除 git worktree；删除不得在无明确确认路径时丢弃已跟踪改动 |
| Notebook 编辑 | 单元格读取与编辑保持 notebook 结构，拒绝畸形 JSON |
| Task 与 team 工具 | 任务创建、分配和完成只对所属 team 可见 |
| Artifact 与 source 记录 | 记录的 artifact 携带 provenance，并在会话重启后可读 |
| Retention 与截断 | 超大工具结果被截断并附带诊断；模型能看到发生了截断 |
| Context budget | 诊断报告预算、用量以及内容被丢弃的原因 |

每个工具还需要一个测试：当工具从 profile allowlist 移除时该测试必须失败。

## 5. Team、arena 与 workflow budget

状态：已实现。`packages/engine/src/agent/team/` 包含 team service、arena、workflow budget ledger、task notification queue、forked-agent cache 和已注册的 `Team` 工具,测试位于 `packages/engine/test/agent/team/`。运行:

```bash
pnpm --filter @hilbras/omnicode-engine exec vitest run test/agent/team
```

计划用例：

| 用例 | 预期 |
|---|---|
| Team 生命周期 | 创建、加入、列出和解散 team；解散释放子 agent 与共享状态 |
| 共享任务列表 | 两个成员看到同一任务状态，不能静默覆盖彼此 |
| Arena 对比 | 同一任务运行多个模型；结果按模型标注，平局时不得虚构胜者 |
| Workflow budget | 预算账本在限额处停止后续模型调用，并报告是哪个步骤触顶 |
| 后台通知 | 完成事件排队，每个消费者只投递一次，重连后仍成立 |
| Forked-agent 缓存 | 缓存分支只复用兼容上下文；基础变化时条目失效 |
| Subagent plan 策略 | 子 agent 不得超出父 profile 的工具策略 |

## 6. OS 级沙箱

状态：核心已实现。`packages/Kaos/src/sandbox/` 包含 bwrap 执行、shell 与路径策略、后端选择、可用性探测和 file worker,测试位于 `packages/Kaos/test/sandbox/`。landlock 后端会报告纯 TypeScript 无法执行强制隔离,并显式失败,不伪装为已隔离。运行:

```bash
pnpm --filter @hilbras/omnicode-kaos exec vitest run test/sandbox
```

计划用例：

| 用例 | 预期 |
|---|---|
| 沙箱可用性 | 运行时报告 bwrap 或 landlock 是否可用，不可用时给出明确原因 |
| 沙箱内命令 | 命令在沙箱中按声明的文件系统和网络策略运行 |
| 路径策略 | 允许根之外的写入显式失败；符号链接遍历不能逃逸沙箱 |
| 权限模式交互 | 沙箱选择不绕过审批；`manual` 仍然提示，`auto` 仍然分类 |
| 失败恢复 | 沙箱启动失败显式且可恢复；不得静默改为无沙箱重试 |
| 诊断 | 沙箱状态可见，且不暴露密钥或工作区之外的宿主路径 |

## 报告规则

- 每个声称通过的用例都附上准确命令和结果。
- 阻塞用例报告为阻塞并注明缺失模块。
- 仅凭阅读代码不得把计划用例变成通过。
- 跳过或未匹配的 suite 报告为未运行，绝不报告为绿色。
