# 人群与 surface 清单(按本仓库重建)

> 这份清单没有照搬移植前的版本。旧版本描述的是老仓库的布局:34 处具体主张里有
> `apps/vscode/`、另一个 `code-app` 仓库,以及老仓库的 issue 编号,这些在本仓库都不存在。
> 现已按本仓库的真实入口、契约文件与守卫测试重建;每一条路径都由
> `validate-surfaces.cjs` 对着文件系统核对(`pnpm check:guards` 会跑它),所以清单里的
> 路径失效时会失败,而不是悄悄变成假事实。
>
> 仍然无法从本仓库证明的一项:仓库之外是否还有别的消费者(桌面端、VS Code 扩展、
> 其它仓库里打包的 web 客户端)。清单把这些点名给作者去对方仓库核对,不猜测。

## 人群与 surface 清单

| 人群 | 入口与契约 | 对他们是破坏性变更 | 守卫 |
|---|---|---|---|
| CLI / TUI 用户 | `apps/omnicode-cli/src/tui`、`apps/omnicode-cli/src/cli`;命令行参数与子命令、`config.toml` 段、TUI 按键与 slash 命令 | 参数或子命令改名/消失、默认值翻转、按键绑定变化、`config.toml` 段或键名变化、终端输出契约(颜色、可打印性、恢复路径)变化 | `apps/omnicode-cli/test/tui`、`apps/omnicode-cli/test/e2e/pty-tui.e2e.test.ts` |
| web 会话可视化用户 | `apps/omnicode-vis/server/src`、`apps/omnicode-vis/web/src`;HTTP 路由与磁盘会话产物的读取形态 | 路由路径或响应字段变化、读取的会话产物格式变化(磁盘格式属于契约) | `apps/omnicode-vis/server/test/routes/context.test.ts`、`apps/omnicode-vis/web/test/api.test.ts` |
| HTTP / WS 客户端 | `packages/server/src/routes`、`packages/server/src/transport/ws`;HTTP/WS 路由、鉴权与 `packages/server` 的 API 表面 | 路由增删或改名、鉴权语义收紧或放宽、WS 路径或帧形态变化、响应字段变化 | `packages/server/test/apiSurface.snapshot.test.ts`、`packages/server/test/wsUpgradeAuth.test.ts` |
| wire 契约消费方(Klient / 自研客户端) | `packages/client-contract/src/contract`(zod 表是源,供 API 与 ACP 共用);工件 `packages/API/docs/wire-contract.json`、`packages/API/docs/wire-contract.md` | 过程名或服务名变化、入参/出参 schema 变化、事件注册形态变化(契约文件是引信,改它等于改 API) | `packages/API/test/wireContract.test.ts`、`packages/API/test/wireContractConformance.test.ts` |
| SDK 调用方 | `packages/SDK/src/index.ts` 是已发布 API;引信是 `packages/SDK/etc/omnicode-sdk.api.md` | 导出增删、签名变化、`ApprovalScope` 等跨界类型变化、config schema 变化 | `packages/SDK/test`、`pnpm --filter @hilbras/omnicode-sdk build:dts`(check 模式) |
| ACP 宿主 | `packages/ACP/src`;ACP 初始化、会话生命周期、turn 与 question 交互 | 协议方法或字段变化、生命周期顺序变化、客户端能力协商变化 | `packages/ACP/test/initialize.test.ts`、`packages/ACP/test/e2e-turn.test.ts` |
| 进程内嵌入 `@hilbras/*` 的消费者 | `packages/engine/src/index.ts` 与各包入口;生成的 `packages/engine/docs/wire-manifest.d.ts`、`packages/engine/docs/contract-types.sha256` 是引信 | 类型声明足迹变化、durable 事件形态变化、config 段变化、注册实现被暴露 | `packages/engine/test`、`pnpm check:generated` |
| 发布 / 打包消费者(npm、native 二进制) | `apps/omnicode-cli/package.json` 与各包 `package.json` 的 `publishConfig`;策略见 `docs/release.md` | 发布入口或 `exports` 变化、`files` 漏掉被 import 的目标、用 npm 而不是 pnpm 发布(会丢 `publishConfig.exports`) | `scripts/check-package-hygiene.mjs`(publint + attw,对 `pnpm pack` 的 tarball) |

## 历史案例

`SKILL.md` 要求每次线上回归复盘后把新人群或新触发线索补进本清单。已归档的案例(每条都指向
现在守着它的测试):

| 回归(改动前能工作,改动后不同) | 人群 | 现在的守卫 |
|---|---|---|
| 搜索一个都没匹配时信息声称"已过滤敏感文件",把没发生过的过滤说成发生了 | CLI / TUI 用户(以及读到该工具输出的模型) | `packages/Tools/test/os/grep/grepTool.test.ts`、`packages/features-integration/test/os/backends/node-local/tools/grep.test.ts` |
| 主题选择器把 Dark 选成浅色、Light 选成深色 | CLI / TUI 用户 | `apps/omnicode-cli/test/tui/terminal-theme.test.ts` |
| 自动模式静默批准 `WebSearch`、`FetchURL`、`Agent` 等工具调用 | CLI 用户(权限轴) | `packages/engine/test/agent/permissionPolicy`、`packages/engine/test/agent/toolApproval` |
| exec policy 标为 prompting 的命令被重复询问,已批准的会话内不生效 | CLI 用户(权限轴) | `packages/engine/test/agent/permissionPolicy`、`packages/engine/test/agent/toolApproval` |
| hook 依赖 shell 语法(管道、重定向)却被当成普通参数执行,或启动失败被静默忽略 | 配置 hook 的用户 | `packages/engine/test/hooks.test.ts`、`packages/engine/test/features/externalHooks/runner.test.ts` |
| provider 的内容安全拒绝被报成普通 API 错误并重试 | 所有 provider 用户 | `packages/llm/test/generate.test.ts`、`packages/SDK/test/errors.test.ts` |
| Telegram bot token 以明文落盘 | Telegram 连接器用户 | `packages/engine/test/app/telegram/telegramService.test.ts` |

补记规则:一次回归只记一行;写清"改动前的行为"和现在守着它的测试路径,不写猜测的人群。
指向 `surfaces.md` 之外文件的路径同样会被 `validate-surfaces.cjs` 核对。

## 触发线索

先按改动路径定位行,再按行给出的守卫找回归证据。命中一个 surface 就必须在清单里有对应行,
否则算漏项;找不到人群的改动进"待作者确认",而不是 finding。

- 改 `apps/omnicode-cli/**` 的终端输出、按键、参数或 config 段 → CLI / TUI 用户。

- 改 `packages/server/**` 的路由、鉴权、WS → HTTP / WS 客户端,同时核对 wire 契约行。
- 改 `packages/client-contract/src/contract/**` → wire 契约消费方;这是引信,必须同时说明仓库外消费方。
- 改 `packages/SDK/src/index.ts` 的导出或 `packages/SDK/src/config/schema.ts` → SDK 调用方,并重跑 `build:dts`。
- 改 `packages/engine/src/**` 的 `Event2`、config schema、state 定义或注册实现的签名 → 进程内消费者,并重跑生成物。
- 改 `packages/ACP/src/**` → ACP 宿主。
- 改 release / native / 打包脚本或 `publishConfig` → 发布与打包消费者。
- 仓库外消费者(桌面端、VS Code 扩展、别处构建的 web 客户端):本仓库无法证明,点名让作者去对方仓库核对。
