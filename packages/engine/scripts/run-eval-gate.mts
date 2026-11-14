import { hermeticEvalCases } from '#/agent/evals/cases';
import { evalGateExitCode, runEvalSuite } from '#/agent/evals/suite';

const report = await runEvalSuite(hermeticEvalCases);

console.log(`eval gate: ${report.passed ? 'PASS' : 'FAIL'} — ${report.summary}`);
for (const result of report.results) {
  console.log(`  ${result.passed ? 'pass' : 'FAIL'}${result.required ? '' : ' (optional)'} ${result.name}`);
  for (const reason of result.reasons) console.log(`    ${reason}`);
}

process.exit(evalGateExitCode(report));
