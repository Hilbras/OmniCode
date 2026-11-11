# 记忆召回评估基线

状态：active  
范围：如何运行记忆召回评估、它测量什么，以及本树记录的基线。  
事实来源：本英文文档。中文镜像为 `docs/zh/quality/memory-recall-evaluation.md`。

相关文档：

- [架构与工作流状态](../architecture/omnicode-architecture.md)
- [端到端测试计划](e2e-test-plan.md)

## 模块

评估模块是 `packages/memory/src/retrieval/evaluation.ts`。它导出：

- `recallAtK`、`precisionAtK`、`reciprocalRank` 和 `average` 指标辅助函数。
- `evaluate(cases, k)`，返回 `RankingMetrics`：`queries`、`recallAtK`、`precisionAtK`、`meanReciprocalRank` 和 `noResult`。
- `EVAL_CORPUS`，15 条带标签记忆，覆盖事实、偏好、数字和否定式问题。
- `EVAL_QUERIES`，15 条查询，与语料条目一一对应。

`evaluate` 拒绝为没有任何相关记忆的用例评分。该保护避免把空结果集报告为完美召回。它同样拒绝非正数 cutoff。

实现服务是 `packages/memory/src/service/memoryService.ts`；相关性选择器是 `packages/memory/src/retrieval/relevanceSelector.ts`。

## 如何运行

排序评估：

```bash
pnpm --filter @hilbras/omnicode-memory exec vitest run test/evaluation.test.ts
```

规模评估，会把带标签查询重复跑在 400 条记忆的语料上：

```bash
pnpm --filter @hilbras/omnicode-memory exec vitest run test/scale.test.ts
```

评估测试填充内存存储，以 `k = 5` 和 `includeUntrusted: true` 运行每条带标签查询，并对返回 id 评分。它还运行三个端到端场景：被纠正的事实取代前身、引用文件变化后离开搜索、以及两个项目存储同一事实但互不串答。

## 基线

2026-11-11 针对本树测量，使用与 `test/evaluation.test.ts` 相同的内存 harness 和带标签语料，`k = 5`：

| 指标 | 值 |
|---|---|
| Queries | 15 |
| recall@5 | 1.000 |
| precision@5 | 1.000 |
| MRR | 1.000 |
| noResult | 0 |

这是本地 harness 测量，不是 CI 结果。评估测试每次运行都断言以下下限：

- recall@5 `>= 1.0`
- precision@5 `>= 0.9`
- MRR `>= 0.95`
- `queries == 15`
- `noResult == 0`
- 重复运行排序完全一致

测试还断言自动注入保持在 `AUTO_INJECT_RETRIEVAL_BUDGET` 内：最大注入上下文不超过预算，平均注入上下文不超过 400 字符，单条查询低于 250 ms。这些上限对慢速 CI 机器足够宽松，同时能捕获无界注入。`packages/memory/AGENTS.md` 记录了更早的注入成本样本；本文档不把依赖机器的耗时重新表述为基线。

## 如何解读

语料刻意小且为合成数据。满分意味着检索路径为每条带标签查询找到目标记忆，并且没有用部分匹配填满剩余槽位。它不证明真实仓库上的质量，也不能替代频道和工具的端到端用例。

这些下限是回归保护。变更使指标低于下限时，修复检索路径或明确记录基线变更；不要静默降低下限。新增语料条目时保持 subject 唯一，并确保每条查询映射到语料 id，因为测试同时断言这两个属性。

## 何时更新基线

语料、评分 cutoff、相关性门控或排序权重变化时更新测量表。记录日期、所用命令，以及测量来自测试 harness 还是其他环境。不要复制无关运行的数字。
