import { existsSync, readFileSync } from 'node:fs';

const failures = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

if (existsSync('.github/workflows/ci.yml') && read('AGENTS.md').includes('There is no root CI workflow')) {
  failures.push('AGENTS.md claims no root CI workflow while .github/workflows/ci.yml exists');
}

if (!existsSync('flake.nix') && read('packages/README.md').includes("flake.nix's workspacePaths")) {
  failures.push('packages/README.md references flake.nix but the tree has none');
}

if (read('docs/en/quality/e2e-test-plan.md').includes('memory_manage') && !existsSync('packages/memory/test/memoryManage.test.ts')) {
  failures.push('E2E docs claim memory_manage coverage but the test file is missing');
}

if (failures.length > 0) {
  console.error('docs claims check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('docs claims check: OK');
