import { verifyGoalCompletion, type VerificationReport } from './verifier';
import type { StoredGoalEvidence } from './goalEvidence';

/**
 * Goal completion gate.
 *
 * The model's `complete` claim is a report, not a proof. Before the goal
 * service accepts it, this gate requires runtime-observed evidence recorded
 * while the goal was active: the newest observation must survive the verifier
 * (traceable provenance, exit code present for runs, not a self-claim), and
 * the newest command run must have succeeded. A failing check refuses the
 * completion instead of downgrading it — the goal stays active and the model
 * can gather real evidence and call again.
 *
 * `OMNICODE_GOAL_VERIFIER=0` (or `false`) disables the gate for operators
 * whose goals legitimately complete without tool observations; any other
 * value, including unset, keeps the gate on.
 */

export const GOAL_VERIFIER_ENV_KEY = 'OMNICODE_GOAL_VERIFIER';

export function isGoalVerifierEnabled(env: NodeJS.ProcessEnv | undefined = process.env): boolean {
  const raw = env?.[GOAL_VERIFIER_ENV_KEY];
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false');
}

export interface GoalCompletionGateInput {
  readonly goalId: string;
  readonly evidence: readonly StoredGoalEvidence[];
}

export interface GoalCompletionGateResult {
  readonly verdict: VerificationReport['verdict'];
  readonly allowed: boolean;
  readonly summary: string;
}

export function gateModelCompletion(input: GoalCompletionGateInput): GoalCompletionGateResult {
  if (input.evidence.length === 0) {
    return {
      verdict: 'rejected',
      allowed: false,
      summary:
        'No runtime-observed evidence was recorded for this goal. Run a verification command ' +
        '(for example the relevant test suite) so the runtime observes an outcome, then call UpdateGoal again.',
    };
  }
  const newest = input.evidence.at(-1)!;
  const report = verifyGoalCompletion({
    goalId: input.goalId,
    checks: [{ id: 'latest-runtime-observation', requires: [newest.id], requireExternal: true }],
    evidence: [newest],
  });
  if (report.verdict !== 'verified') {
    return { verdict: report.verdict, allowed: false, summary: report.summary };
  }
  const newestRun = input.evidence.findLast(
    (record) => record.source === 'command_run' || record.source === 'test_run',
  );
  if (newestRun !== undefined && newestRun.exitCode !== 0) {
    return {
      verdict: 'rejected',
      allowed: false,
      summary: `Newest observed command run failed with exit code ${String(newestRun.exitCode)} (${newestRun.provenance}); fix it and re-run before completing.`,
    };
  }
  return { verdict: 'verified', allowed: true, summary: report.summary };
}
