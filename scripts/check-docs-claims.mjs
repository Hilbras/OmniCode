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

if (existsSync('CONTRIBUTING.md')) {
  const contributing = read('CONTRIBUTING.md');
  const lintScript = JSON.parse(read('package.json')).scripts?.lint ?? '';
  const lintIsReal = lintScript.length > 0 && lintScript !== 'turbo run lint';
  if (lintIsReal && contributing.includes('`pnpm lint` is a Turbo no-op')) {
    failures.push('CONTRIBUTING.md claims `pnpm lint` is a no-op while scripts.lint is real');
  }
  if (contributing.includes('test` / `e2e` scripts call a root script that does not exist')) {
    const cliScripts = JSON.parse(read('apps/omnicode-cli/package.json')).scripts ?? {};
    if (String(cliScripts.test ?? '').includes('build:cli')) {
      failures.push('CONTRIBUTING.md claims the CLI test script calls a missing root script');
    }
  }
}

if (existsSync('.github/workflows/release.yml') && existsSync('docs/release.md')) {
  const release = read('docs/release.md');
  for (const phrase of [
    'publish workflow is deliberately not written yet',
    'Publishing `@hilbras/omnicode` is currently a manual step',
  ]) {
    if (release.includes(phrase)) {
      failures.push(`docs/release.md claims publishing is manual while release.yml exists (${phrase})`);
    }
  }
}

if (failures.length > 0) {
  console.error('docs claims check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('docs claims check: OK');
