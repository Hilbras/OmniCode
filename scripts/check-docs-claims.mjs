import { existsSync, readFileSync } from 'node:fs';

const failures = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

// Every check runs against each translation. A claim that holds in `docs/en` and drifts
// in `docs/zh` is still a stale claim in the doc a Chinese reader gets, and the guard
// used to read the English file only.
const E2E_PLAN_COPIES = ['docs/en/quality/e2e-test-plan.md', 'docs/zh/quality/e2e-test-plan.md'];
const FLAKE_FREE_GUIDES = ['AGENTS.md', 'packages/memory/AGENTS.md', 'docs/release.md'];
// Two phrasings exist today: "no `flake.nix` in this tree" (AGENTS.md, memory guide) and
// "this tree has no `flake.nix`" (release.md). Match the idea, not one sentence.
const FLAKE_FREE_PHRASES = ['no `flake.nix` in this tree', 'has no `flake.nix`'];

if (existsSync('.github/workflows/ci.yml') && read('AGENTS.md').includes('There is no root CI workflow')) {
  failures.push('AGENTS.md claims no root CI workflow while .github/workflows/ci.yml exists');
}

if (!existsSync('flake.nix')) {
  if (read('packages/README.md').includes("flake.nix's workspacePaths")) {
    failures.push('packages/README.md references flake.nix but the tree has none');
  }
} else {
  // The inverse direction: three guides assert the tree has no `flake.nix`. Adding one
  // must update them, or the guides go on lying about the workspace layout.
  for (const guide of FLAKE_FREE_GUIDES) {
    if (!existsSync(guide)) continue;
    const text = read(guide);
    if (FLAKE_FREE_PHRASES.some((phrase) => text.includes(phrase))) {
      failures.push(`${guide} claims there is no flake.nix, but one is present`);
    }
  }
}

for (const plan of E2E_PLAN_COPIES) {
  if (!existsSync(plan)) continue;
  if (read(plan).includes('memory_manage') && !existsSync('packages/memory/test/memoryManage.test.ts')) {
    failures.push(`${plan} claims memory_manage coverage but the test file is missing`);
  }
}

if (failures.length > 0) {
  console.error('docs claims check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('docs claims check: OK');
