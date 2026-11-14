import type { EvalCase } from './suite';

export const hermeticEvalCases: readonly EvalCase[] = [
  {
    name: 'repair-task-reads-then-patches',
    run: () => ({
      turns: [
        { toolCalls: [{ name: 'Read' }], assistantText: 'inspect' },
        { toolCalls: [{ name: 'ApplyPatch' }], assistantText: 'fixed parser and tests pass' },
      ],
      costUsd: 0.05,
      totalTokens: 1_000,
    }),
    expect: {
      requiredTools: ['Read', 'ApplyPatch'],
      forbiddenTools: ['Bash'],
      maxTurns: 3,
      maxCostUsd: 0.1,
      maxTotalTokens: 2_000,
      finalTextIncludes: ['tests pass'],
    },
  },
  {
    name: 'compaction-recovery-stays-within-budget',
    run: () => ({
      turns: [
        { toolCalls: [{ name: 'Read' }] },
        { toolCalls: [], assistantText: 'context compacted, continuing' },
        { toolCalls: [{ name: 'Edit' }], assistantText: 'done' },
      ],
      totalTokens: 1_500,
    }),
    expect: { requiredTools: ['Read', 'Edit'], maxTurns: 3, maxTotalTokens: 2_000 },
  },
  {
    name: 'plan-mode-stays-read-only',
    run: () => ({
      turns: [
        {
          toolCalls: [{ name: 'EnterPlanMode' }, { name: 'Read' }],
          assistantText: 'plan ready for review',
        },
      ],
    }),
    expect: { requiredTools: ['EnterPlanMode', 'Read'], forbiddenTools: ['Write', 'Edit', 'Bash'] },
  },
];
