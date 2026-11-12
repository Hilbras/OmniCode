import { describe, expect, it } from 'vitest';

import { scoreTrajectory } from '#/agent/evals/trajectory';

describe('trajectory eval scorer', () => {
  it('passes when required tools and final text are present within budgets', () => {
    const score = scoreTrajectory(
      {
        turns: [
          { toolCalls: [{ name: 'Read' }], assistantText: 'reading' },
          { toolCalls: [{ name: 'Edit' }], assistantText: 'done: fixed parser' },
        ],
        costUsd: 0.1,
        totalTokens: 100,
      },
      {
        requiredTools: ['Read', 'Edit'],
        forbiddenTools: ['Bash'],
        maxTurns: 2,
        maxCostUsd: 0.2,
        maxTotalTokens: 200,
        finalTextIncludes: ['fixed parser'],
      },
    );
    expect(score).toMatchObject({ passed: true, usedTools: ['Read', 'Edit'], turns: 2 });
  });

  it('fails missing, forbidden, and final-text expectations', () => {
    const score = scoreTrajectory(
      { turns: [{ toolCalls: [{ name: 'Bash' }], assistantText: 'no' }] },
      { requiredTools: ['Edit'], forbiddenTools: ['Bash'], finalTextIncludes: ['yes'] },
    );
    expect(score.passed).toBe(false);
    expect(score.reasons).toEqual([
      'missing required tool: Edit',
      'used forbidden tool: Bash',
      'final text missing: yes',
    ]);
  });

  it('enforces turn, cost, and token budgets', () => {
    const score = scoreTrajectory(
      { turns: [{ toolCalls: [] }, { toolCalls: [] }], costUsd: 1, totalTokens: 500 },
      { maxTurns: 1, maxCostUsd: 0.5, maxTotalTokens: 100 },
    );
    expect(score.reasons).toEqual([
      'turn count 2 exceeds 1',
      'cost 1 exceeds 0.5',
      'tokens 500 exceed 100',
    ]);
  });
});
