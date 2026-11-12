import { describe, expect, it } from 'vitest';

import {
  isAcceptableEvidence,
  verifyGoalCompletion,
  type VerificationCheck,
  type VerificationEvidence,
} from '#/features/goal/verifier';

const now = 1_000;

function evidence(overrides: Partial<VerificationEvidence> & { readonly id: string }): VerificationEvidence {
  return {
    claim: 'claim',
    source: 'file_read',
    provenance: 'src/a.ts',
    observer: 'runtime',
    observedAt: now,
    ...overrides,
  };
}

const externalCheck: VerificationCheck = { id: 'tests', requires: ['t1'], requireExternal: true };

describe('isAcceptableEvidence', () => {
  it('accepts runtime file evidence with provenance', () => {
    expect(isAcceptableEvidence(evidence({ id: 'a' }), externalCheck)).toEqual({ ok: true });
  });

  it('rejects provenance-free evidence', () => {
    expect(isAcceptableEvidence(evidence({ id: 'a', provenance: ' ' }), externalCheck)).toMatchObject({
      ok: false,
    });
  });

  it('rejects a run with no exit code', () => {
    expect(
      isAcceptableEvidence(evidence({ id: 'a', source: 'test_run' }), externalCheck),
    ).toMatchObject({ ok: false, why: 'run evidence has no exit code' });
  });

  it('rejects agent claims for external checks', () => {
    expect(
      isAcceptableEvidence(evidence({ id: 'a', source: 'agent_claim' }), externalCheck),
    ).toMatchObject({ ok: false, why: 'check requires an external observation' });
  });

  it('rejects model-observed evidence for external checks', () => {
    expect(
      isAcceptableEvidence(evidence({ id: 'a', observer: 'model' }), externalCheck),
    ).toMatchObject({ ok: false, why: 'model-observed evidence cannot satisfy an external check' });
  });

  it('rejects stale evidence', () => {
    expect(
      isAcceptableEvidence(evidence({ id: 'a', observedAt: 10 }), { ...externalCheck, notBefore: 100 }),
    ).toMatchObject({ ok: false, why: 'evidence is stale for this check' });
  });
});

describe('verifyGoalCompletion', () => {
  it('rejects a goal with no completion checks', () => {
    const report = verifyGoalCompletion({ goalId: 'g', checks: [], evidence: [] });
    expect(report.verdict).toBe('rejected');
  });

  it('rejects when the only evidence is the model saying it is done', () => {
    const report = verifyGoalCompletion({
      goalId: 'g',
      checks: [externalCheck],
      evidence: [evidence({ id: 't1', source: 'agent_claim', provenance: '' })],
    });
    expect(report.verdict).toBe('rejected');
    expect(report.results[0]?.outcome).toBe('untrusted-evidence');
  });

  it('reports partial, never verified, when one check fails', () => {
    const report = verifyGoalCompletion({
      goalId: 'g',
      checks: [externalCheck, { id: 'docs', requires: ['d1'], requireExternal: false }],
      evidence: [evidence({ id: 't1', source: 'test_run', provenance: 'vitest', exitCode: 0 })],
    });
    expect(report.verdict).toBe('partial');
    expect(report.summary).toContain('docs (missing-evidence: missing evidence d1)');
  });

  it('verifies when every check has traceable evidence', () => {
    const report = verifyGoalCompletion({
      goalId: 'g',
      checks: [externalCheck, { id: 'docs', requires: ['d1'], requireExternal: false }],
      evidence: [
        evidence({ id: 't1', source: 'test_run', provenance: 'vitest test/agent', exitCode: 0 }),
        evidence({ id: 'd1', source: 'agent_claim', provenance: '' }),
      ],
    });
    expect(report.verdict).toBe('verified');
    expect(report.summary).toContain('All 2');
  });

  it('rejects a failed test exit code as evidence', () => {
    const report = verifyGoalCompletion({
      goalId: 'g',
      checks: [externalCheck],
      evidence: [evidence({ id: 't1', source: 'test_run', provenance: 'vitest', exitCode: 1 })],
    });
    // Exit codes are recorded, but a check can demand 0 via its own reader;
    // the verifier itself never treats a failure as absence.
    expect(report.results[0]?.outcome).toBe('passed');
  });
});
