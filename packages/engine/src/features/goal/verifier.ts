/**
 * Independent goal verifier.
 *
 * A model that declares its own goal complete is reporting, not proving. This
 * verifier is deliberately hostile to that report: every claimed piece of
 * evidence must carry a provenance that the *runtime* can vouch for (a file it
 * read, a command it ran and its exit code, a test it executed), and the claim
 * must survive the checks the goal's completion criterion names.
 *
 * Rules:
 *
 * - Evidence with no provenance is not evidence. "I implemented it" is a claim.
 * - Evidence the model produced about itself (`agent_claim`) never satisfies a
 *   check that requires an external observation.
 * - A failing check rejects the verification even when other checks pass;
 *   `partial` is reported, not upgraded to `verified`.
 * - Stale evidence (recorded before the checks started re-running) does not
 *   count toward the final verdict when the criterion requires a fresh run.
 *
 * The verifier is pure: the caller supplies an evidence reader, so it never
 * trusts the model's description of what exists.
 */

export type EvidenceSource = 'file_read' | 'command_run' | 'test_run' | 'agent_claim';

export interface VerificationEvidence {
  readonly id: string;
  /** What was observed, e.g. "tests/loop.test.ts passes". */
  readonly claim: string;
  readonly source: EvidenceSource;
  /** Where it came from: path, command, or test id. Required for every source except agent_claim. */
  readonly provenance: string;
  /** Exit status for run-based sources; `undefined` for reads and claims. */
  readonly exitCode?: number | undefined;
  readonly observer: 'runtime' | 'model';
  readonly observedAt: number;
}

export interface VerificationCheck {
  readonly id: string;
  /** Evidence this check needs; all listed ids must be present and acceptable. */
  readonly requires: readonly string[];
  /** Reject agent_claim evidence for this check. */
  readonly requireExternal: boolean;
  /** Only evidence observed at or after this timestamp counts. */
  readonly notBefore?: number;
}

export interface VerificationInput {
  readonly goalId: string;
  readonly checks: readonly VerificationCheck[];
  readonly evidence: readonly VerificationEvidence[];
}

export type CheckOutcome = 'passed' | 'failed' | 'missing-evidence' | 'untrusted-evidence';

export interface CheckResult {
  readonly checkId: string;
  readonly outcome: CheckOutcome;
  readonly evidenceIds: readonly string[];
  readonly why?: string;
}

export type VerificationVerdict = 'verified' | 'partial' | 'rejected';

export interface VerificationReport {
  readonly goalId: string;
  readonly verdict: VerificationVerdict;
  readonly results: readonly CheckResult[];
  readonly summary: string;
}

/** An evidence record is acceptable only if it can be traced to an observation. */
export function isAcceptableEvidence(
  evidence: VerificationEvidence,
  check: VerificationCheck,
): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  const traceable = evidence.source !== 'agent_claim' && evidence.provenance.trim().length > 0;
  if (!traceable && evidence.source !== 'agent_claim') {
    return { ok: false, why: 'evidence has no provenance' };
  }
  if (evidence.source === 'agent_claim' && check.requireExternal) {
    return { ok: false, why: 'check requires an external observation' };
  }
  if ((evidence.source === 'command_run' || evidence.source === 'test_run') && evidence.exitCode === undefined) {
    return { ok: false, why: 'run evidence has no exit code' };
  }
  if (evidence.observer === 'model' && check.requireExternal) {
    return { ok: false, why: 'model-observed evidence cannot satisfy an external check' };
  }
  if (check.notBefore !== undefined && evidence.observedAt < check.notBefore) {
    return { ok: false, why: 'evidence is stale for this check' };
  }
  return { ok: true };
}

export function verifyGoalCompletion(input: VerificationInput): VerificationReport {
  const byId = new Map(input.evidence.map((evidence) => [evidence.id, evidence]));
  const results: CheckResult[] = [];

  for (const check of input.checks) {
    const found: string[] = [];
    let outcome: CheckOutcome = 'passed';
    let why: string | undefined;

    for (const requiredId of check.requires) {
      const evidence = byId.get(requiredId);
      if (evidence === undefined) {
        outcome = 'missing-evidence';
        why = `missing evidence ${requiredId}`;
        break;
      }
      const verdict = isAcceptableEvidence(evidence, check);
      if (!verdict.ok) {
        outcome = 'untrusted-evidence';
        why = `${requiredId}: ${verdict.why}`;
        found.push(requiredId);
        break;
      }
      found.push(requiredId);
    }

    results.push({ checkId: check.id, outcome, evidenceIds: found, ...(why === undefined ? {} : { why }) });
  }

  const failed = results.filter((result) => result.outcome !== 'passed');
  if (input.checks.length === 0) {
    return {
      goalId: input.goalId,
      verdict: 'rejected',
      results,
      summary: 'Goal has no completion checks; completion cannot be verified.',
    };
  }
  if (failed.length === 0) {
    return {
      goalId: input.goalId,
      verdict: 'verified',
      results,
      summary: `All ${String(results.length)} completion check(s) verified with traceable evidence.`,
    };
  }
  const passed = results.length - failed.length;
  return {
    goalId: input.goalId,
    verdict: passed === 0 ? 'rejected' : 'partial',
    results,
    summary:
      `${String(failed.length)} of ${String(results.length)} completion check(s) not verified: ` +
      failed.map((result) => `${result.checkId} (${result.outcome}${result.why === undefined ? '' : `: ${result.why}`})`).join('; '),
  };
}
