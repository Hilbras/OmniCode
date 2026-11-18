import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ENGINE = '@hilbras/omnicode-engine';
const API = '@hilbras/omnicode-api';
const CLI = '@omnicode/cli';

const GENERATED = [
  { package: ENGINE, artifact: 'packages/engine/docs/config-manifest.toml', script: 'gen:config-manifest' },
  { package: ENGINE, artifact: 'packages/engine/docs/wire-manifest.d.ts', script: 'gen:wire-manifest' },
  { package: ENGINE, artifact: 'packages/engine/docs/state-manifest.d.ts', script: 'gen:state-manifest' },
  { package: ENGINE, artifact: 'packages/engine/docs/contract-types.sha256', script: 'gen:contract-types' },
  { package: API, artifact: 'packages/API/docs/wire-contract.json', script: 'gen:wire-contract' },
  { package: API, artifact: 'packages/API/docs/wire-contract.md', script: 'gen:api-reference' },
  {
    package: '@hilbras/omnicode-client-contract',
    artifact: 'packages/client-contract/src/generated/wireTypes.ts',
    script: 'gen:wire-types',
  },
  {
    package: CLI,
    artifact: 'apps/omnicode-cli/src/generated/vis-web-asset.ts',
    script: 'gen:vis-asset',
  },
];

const failures = [];

for (const { package: pkg, artifact, script } of GENERATED) {
  const regenerate = `pnpm --filter ${pkg} ${script}`;
  if (!existsSync(artifact)) {
    failures.push(`${artifact} is missing — regenerate with ${regenerate}`);
    continue;
  }
  const run = spawnSync('pnpm', ['--filter', pkg, 'run', script, '--', '--check'], {
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    const detail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    if (detail !== '') console.error(detail);
    failures.push(`${artifact} is stale — regenerate with ${regenerate}`);
    continue;
  }
  console.log(`generated artifact is fresh: ${artifact}`);
}

if (failures.length > 0) {
  console.error('generated artifacts check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`generated artifacts check: OK (${GENERATED.length} artifacts)`);
