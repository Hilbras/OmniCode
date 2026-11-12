import { describe, expect, it } from 'vitest';

import { evalGateExitCode, runEvalSuite, type EvalCase } from '#/agent/evals/suite';

function evalCase(overrides: Partial<EvalCase> & { readonly name: string }): EvalCase {
  return {
    run: () => ({ turns: [{ toolCalls: [{ name: 'Read' }] }] }),
    expect: { requiredTools: ['Read'] },
    ...overrides,
  };
}

describe('runEvalSuite', () => {
  it('passes when every required case passes', async () => {
    const report = await runEvalSuite([evalCase({ name: 'a' }), evalCase({ name: 'b' })]);
    expect(report.passed).toBe(true);
    expect(report.summary).toContain('All 2');
    expect(evalGateExitCode(report)).toBe(0);
  });

  it('fails the gate on a required failure', async () => {
    const report = await runEvalSuite([
      evalCase({ name: 'a' }),
      evalCase({ name: 'b', expect: { requiredTools: ['ApplyPatch'] } }),
    ]);
    expect(report.passed).toBe(false);
    expect(report.requiredFailures).toEqual(['b']);
    expect(report.results[1]?.reasons).toContain('missing required tool: ApplyPatch');
    expect(evalGateExitCode(report)).toBe(1);
  });

  it('lets an optional failure through but reports it', async () => {
    const report = await runEvalSuite([
      evalCase({ name: 'a' }),
      evalCase({ name: 'flaky', required: false, expect: { requiredTools: ['Bash'] } }),
    ]);
    expect(report.passed).toBe(true);
    expect(report.summary).toContain('1 optional failure(s)');
  });

  it('fails a case that throws instead of skipping it', async () => {
    const report = await runEvalSuite([
      evalCase({
        name: 'broken',
        run: () => {
          throw new Error('fixture missing');
        },
      }),
    ]);
    expect(report.passed).toBe(false);
    expect(report.results[0]?.reasons[0]).toContain('case threw: fixture missing');
  });

  it('fails an empty suite', async () => {
    const report = await runEvalSuite([]);
    expect(report.passed).toBe(false);
    expect(report.summary).toContain('no cases');
  });

  it('awaits async case factories', async () => {
    const report = await runEvalSuite([
      evalCase({ name: 'async', run: async () => ({ turns: [{ toolCalls: [{ name: 'Read' }] }] }) }),
    ]);
    expect(report.passed).toBe(true);
  });
});
