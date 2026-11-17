#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const options = new Set(process.argv.slice(2));
const known = new Set(['--dry-run', '--skip-typecheck', '--skip-tests', '--help', '-h']);

const dryRun = options.has('--dry-run');
const skipTypecheck = options.has('--skip-typecheck');
const skipTests = options.has('--skip-tests');

function usage() {
  console.log('usage: node scripts/preflight.mjs [--dry-run] [--skip-typecheck] [--skip-tests]');
  console.log('');
  console.log('  --dry-run         print every step without executing it');
  console.log('  --skip-typecheck  run guards and targeted tests only');
  console.log('  --skip-tests      run guards and package typechecks only');
  console.log('  --help, -h        show this message');
}

if (options.has('--help') || options.has('-h')) {
  usage();
  process.exit(0);
}

for (const option of options) {
  if (!known.has(option)) {
    console.error(`preflight: unknown option ${option}`);
    usage();
    process.exit(2);
  }
}

const steps = [
  { name: 'workspace', args: ['check:workspace'] },
  { name: 'guards', args: ['check:guards'] },
  { name: 'lint', args: ['lint'] },
];

if (!skipTypecheck) {
  steps.push(
    { name: 'typecheck:engine', args: ['--filter', '@hilbras/omnicode-engine', 'typecheck'] },
    { name: 'typecheck:memory', args: ['--filter', '@hilbras/omnicode-memory', 'typecheck'] },
    { name: 'typecheck:channels', args: ['--filter', '@hilbras/omnicode-channels', 'typecheck'] },
    { name: 'typecheck:tools', args: ['--filter', '@hilbras/omnicode-tools', 'typecheck'] },
    { name: 'typecheck:kaos', args: ['--filter', '@hilbras/omnicode-kaos', 'typecheck'] },
    { name: 'typecheck:api', args: ['--filter', '@hilbras/omnicode-api', 'typecheck'] },
    { name: 'typecheck:cli', args: ['--filter', '@omnicode/cli', 'typecheck'] },
  );
}

if (!skipTests) {
  steps.push(
    {
      name: 'test:permission-policy',
      args: ['--filter', '@hilbras/omnicode-engine', 'exec', 'vitest', 'run', 'test/agent/permissionPolicy'],
    },
    {
      name: 'test:memory-lifecycle',
      args: [
        '--filter',
        '@hilbras/omnicode-memory',
        'exec',
        'vitest',
        'run',
        'test/evaluation.test.ts',
        'test/dreamConsolidation.test.ts',
        'test/relevanceSelector.test.ts',
        'test/maintenance.test.ts',
        'test/injection.test.ts',
        'test/memoryManage.test.ts',
        'test/reranker.test.ts',
      ],
    },
    {
      name: 'test:bash-sandbox',
      args: ['--filter', '@hilbras/omnicode-features-integration', 'exec', 'vitest', 'run', 'test/os/backends/node-local/tools/bash.test.ts'],
    },
    {
      name: 'test:engine-resilience',
      args: [
        '--filter',
        '@hilbras/omnicode-engine',
        'exec',
        'vitest',
        'run',
        'test/agent/contextMemory/microcompaction.test.ts',
        'test/agent/fullCompaction/strategy.test.ts',
        'test/human/llm/requester/retry.test.ts',
        'test/agent/toolResultTruncation/toolResultTruncation.test.ts',
        'test/agent/team/taskNotificationQueue.test.ts',
        'test/agent/team/teamPersistence.test.ts',
        'test/agent/evals/trajectory.test.ts',
        'test/evals/agentBehavior.test.ts',
        'test/features/sessionSearch/localSessionSearch.test.ts',
      ],
    },
    { name: 'test:telemetry', args: ['--filter', '@hilbras/omnicode-telemetry', 'test'] },
    { name: 'test:llm', args: ['--filter', '@hilbras/omnicode-llm', 'test'] },
    {
      name: 'test:security-hardening',
      args: [
        '--filter',
        '@hilbras/omnicode-engine',
        'exec',
        'vitest',
        'run',
        'test/features/externalHooks/runner.test.ts',
        'test/app/plugin/manager.test.ts',
        'test/app/plugin/source.test.ts',
        'test/mcpCore/command-policy.test.ts',
        'test/mcpCore/client-stdio.test.ts',
        'test/app/sessionManager/sessionLease.test.ts',
        'src/human/test/interaction/persistence.test.ts',
      ],
    },
    { name: 'test:channels', args: ['--filter', '@hilbras/omnicode-channels', 'test'] },
    { name: 'test:api-connectivity', args: ['--filter', '@hilbras/omnicode-api', 'exec', 'vitest', 'run', 'test/workstream-connectivity.test.ts'] },
    { name: 'test:tools', args: ['--filter', '@hilbras/omnicode-tools', 'test'] },
    {
      name: 'test:engine-team',
      args: ['--filter', '@hilbras/omnicode-engine', 'exec', 'vitest', 'run', 'test/agent/team'],
    },
    {
      name: 'test:kaos-sandbox',
      args: ['--filter', '@hilbras/omnicode-kaos', 'exec', 'vitest', 'run', 'test/sandbox'],
    },
    {
      name: 'eval-gate',
      args: ['--filter', '@hilbras/omnicode-engine', 'exec', 'tsx', 'scripts/run-eval-gate.mts'],
    },
  );
}

function commandLine(args) {
  return [PNPM, ...args].join(' ');
}

if (dryRun) {
  console.log(`preflight: dry run (${String(steps.length)} steps)`);
  for (const [index, step] of steps.entries()) {
    console.log(`  ${String(index + 1).padStart(2)}. ${step.name}: ${commandLine(step.args)}`);
  }
  console.log('preflight: dry run OK');
  process.exit(0);
}

const failures = [];
for (const [index, step] of steps.entries()) {
  console.log(`\npreflight: [${String(index + 1)}/${String(steps.length)}] ${step.name}`);
  console.log(`  $ ${commandLine(step.args)}`);
  const started = Date.now();
  const result = spawnSync(PNPM, step.args, { cwd: ROOT, stdio: 'inherit' });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error !== undefined) {
    failures.push({ step, reason: result.error.message });
    break;
  }
  if (result.status !== 0) {
    failures.push({ step, reason: `exit code ${String(result.status)}` });
    break;
  }
  console.log(`  ok (${elapsed}s)`);
}

if (failures.length > 0) {
  const [failure] = failures;
  console.error('\npreflight: FAILED');
  console.error(`  step:    ${failure.step.name}`);
  console.error(`  command: ${commandLine(failure.step.args)}`);
  console.error(`  reason:  ${failure.reason}`);
  const completed = steps.findIndex((step) => step === failure.step) + 1;
  const remaining = steps.slice(completed);
  if (remaining.length > 0) {
    console.error(`  skipped: ${remaining.map((step) => step.name).join(', ')}`);
  }
  process.exit(1);
}

console.log(`\npreflight: OK (${String(steps.length)} steps)`);
