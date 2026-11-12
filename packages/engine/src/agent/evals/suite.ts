/**
 * Trajectory eval suite runner.
 *
 * `scoreTrajectory` answers "did this one run behave". This module answers
 * "does the suite still behave" — it runs every case, enforces per-case
 * expectations, and turns the pass/fail set into a CI gate.
 *
 * The gate is intentionally strict about the two failure modes that make eval
 * suites useless:
 *
 * - A case that throws is a failure, not a skip: a broken fixture must not
 *   silently reduce coverage.
 * - An empty suite fails. "All zero cases passed" is how a misconfigured glob
 *   ships a green build with no evals at all.
 *
 * The runner is synchronous and pure. Each case supplies its own trajectory
 * factory, so a real agent run can be spliced in without changing the runner.
 */

import { scoreTrajectory, type EvalExpectation, type EvalTrajectory } from './trajectory';

export interface EvalCase {
  readonly name: string;
  /** Produces the trajectory to score; may throw, which fails the case. */
  readonly run: () => EvalTrajectory | Promise<EvalTrajectory>;
  readonly expect: EvalExpectation;
  /** Marks a case that must pass for the gate to go green. Default true. */
  readonly required?: boolean;
}

export interface EvalCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly required: boolean;
  readonly reasons: readonly string[];
}

export interface EvalSuiteReport {
  readonly passed: boolean;
  readonly results: readonly EvalCaseResult[];
  readonly requiredFailures: readonly string[];
  readonly summary: string;
}

export async function runEvalSuite(cases: readonly EvalCase[]): Promise<EvalSuiteReport> {
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    const required = evalCase.required !== false;
    try {
      const trajectory = await evalCase.run();
      const score = scoreTrajectory(trajectory, evalCase.expect);
      results.push({ name: evalCase.name, passed: score.passed, required, reasons: score.reasons });
    } catch (error) {
      results.push({
        name: evalCase.name,
        passed: false,
        required,
        reasons: [`case threw: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }

  if (results.length === 0) {
    return {
      passed: false,
      results,
      requiredFailures: ['<empty suite>'],
      summary: 'Eval suite has no cases; a green build from an empty suite proves nothing.',
    };
  }

  const requiredFailures = results
    .filter((result) => result.required && !result.passed)
    .map((result) => result.name);
  const passed = requiredFailures.length === 0;
  const failures = results.filter((result) => !result.passed).length;
  return {
    passed,
    results,
    requiredFailures,
    summary: passed
      ? `All ${String(results.length)} required eval case(s) passed` +
        (failures === 0 ? '' : ` (${String(failures)} optional failure(s))`)
      : `${String(requiredFailures.length)} required eval case(s) failed: ${requiredFailures.join(', ')}`,
  };
}

/** One-line gate decision; CI prints this and exits non-zero when false. */
export function evalGateExitCode(report: EvalSuiteReport): 0 | 1 {
  return report.passed ? 0 : 1;
}
