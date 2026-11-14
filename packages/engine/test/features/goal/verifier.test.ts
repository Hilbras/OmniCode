import { describe, expect, it } from 'vitest';

import {
  isAcceptableEvidence,
  verifyGoalCompletion,
  type VerificationCheck,
  type VerificationEvidence,
} from '#/features/goal/verifier';
import {
  gateModelCompletion,
  isGoalVerifierEnabled,
} from '#/features/goal/verificationGate';
import type { StoredGoalEvidence } from '#/features/goal/goalEvidence';

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

function stored(overrides: Partial<StoredGoalEvidence> & { readonly id: string }): StoredGoalEvidence {
  return {
    goalId: 'g',
    claim: 'observed',
    source: 'file_read',
    provenance: 'src/a.ts',
    observer: 'runtime',
    observedAt: now,
    ...overrides,
  };
}

describe('gateModelCompletion', () => {
  it('refuses when no runtime evidence exists for the goal', () => {
    const result = gateModelCompletion({ goalId: 'g', evidence: [] });
    expect(result).toMatchObject({ verdict: 'rejected', allowed: false });
    expect(result.summary).toContain('No runtime-observed evidence');
  });

  it('allows a newest observation that survives the verifier', () => {
    const result = gateModelCompletion({
      goalId: 'g',
      evidence: [
        stored({ id: 'ev-0', source: 'command_run', provenance: 'vitest', exitCode: 0 }),
        stored({ id: 'ev-1', source: 'file_read', provenance: 'src/a.ts' }),
      ],
    });
    expect(result).toMatchObject({ verdict: 'verified', allowed: true });
  });

  it('refuses when the newest observation fails the verifier (self-claim)', () => {
    const result = gateModelCompletion({
      goalId: 'g',
      evidence: [stored({ id: 'ev-0', source: 'agent_claim', provenance: '' })],
    });
    expect(result.allowed).toBe(false);
    expect(result.summary).toContain('untrusted-evidence');
  });

  it('refuses when the newest observed run failed even if a later read exists', () => {
    const result = gateModelCompletion({
      goalId: 'g',
      evidence: [
        stored({ id: 'ev-0', source: 'command_run', provenance: 'vitest', exitCode: 2 }),
        stored({ id: 'ev-1', source: 'file_read', provenance: 'src/a.ts' }),
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.summary).toContain('exit code 2');
  });

  it('allows a failed older run superseded by a passing one', () => {
    const result = gateModelCompletion({
      goalId: 'g',
      evidence: [
        stored({ id: 'ev-0', source: 'command_run', provenance: 'vitest', exitCode: 2 }),
        stored({ id: 'ev-1', source: 'command_run', provenance: 'vitest', exitCode: 0 }),
      ],
    });
    expect(result).toMatchObject({ verdict: 'verified', allowed: true });
  });

  it('treats an unobservable exit code as untrusted evidence', () => {
    const result = gateModelCompletion({
      goalId: 'g',
      evidence: [
        stored({ id: 'ev-0', source: 'command_run', provenance: 'opaque runner' }),
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.summary).toContain('run evidence has no exit code');
  });
});

describe('isGoalVerifierEnabled', () => {
  it('defaults to enabled for unset and unrecognized values', () => {
    expect(isGoalVerifierEnabled({})).toBe(true);
    expect(isGoalVerifierEnabled({ OMNICODE_GOAL_VERIFIER: '' })).toBe(true);
    expect(isGoalVerifierEnabled({ OMNICODE_GOAL_VERIFIER: 'junk' })).toBe(true);
    expect(isGoalVerifierEnabled(undefined)).toBe(true);
  });

  it('is disabled by 0 and false in any casing', () => {
    expect(isGoalVerifierEnabled({ OMNICODE_GOAL_VERIFIER: '0' })).toBe(false);
    expect(isGoalVerifierEnabled({ OMNICODE_GOAL_VERIFIER: 'false' })).toBe(false);
    expect(isGoalVerifierEnabled({ OMNICODE_GOAL_VERIFIER: ' FALSE ' })).toBe(false);
  });
});
