import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOTS = ['apps', 'packages'];

function packageDirs() {
  const dirs = [];
  for (const root of ROOTS) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!existsSync(join(dir, 'package.json'))) continue;
      dirs.push(dir);
    }
  }
  return dirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function detail(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

const checked = [];
const failures = [];

for (const dir of packageDirs()) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (manifest.publishConfig === undefined) continue;

  const unbuilt = (manifest.files ?? [])
    .filter((entry) => !entry.includes('*'))
    .filter((entry) => !existsSync(join(dir, entry)));
  if (unbuilt.length > 0) {
    failures.push(
      `${manifest.name}: ${unbuilt.join(', ')} is listed in "files" but missing — build the package before this check`,
    );
    continue;
  }

  const lint = run('pnpm', ['--filter', manifest.name, 'exec', 'publint']);
  if (lint.status !== 0) {
    const output = detail(lint);
    if (output !== '') console.error(output);
    failures.push(`${manifest.name}: publint reported problems`);
    continue;
  }

  const publishedTypes = Object.values(manifest.publishConfig.exports ?? {}).some(
    (entry) => typeof entry === 'object' && entry !== null && entry.types !== undefined,
  );
  if (!publishedTypes) {
    checked.push(`${manifest.name} (publint)`);
    continue;
  }

  const packDir = mkdtempSync(join(tmpdir(), 'omnicode-hygiene-pack-'));
  try {
    const pack = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: dir });
    const tarballs = existsSync(packDir) ? readdirSync(packDir).filter((f) => f.endsWith('.tgz')) : [];
    if (pack.status !== 0 || tarballs.length === 0) {
      const output = detail(pack);
      if (output !== '') console.error(output);
      failures.push(`${manifest.name}: pnpm pack produced no tarball`);
      continue;
    }
    const tarball = join(packDir, tarballs[0]);
    const types = run('pnpm', [
      '--filter',
      manifest.name,
      'exec',
      'attw',
      tarball,
      '--profile',
      'esm-only',
      '--no-emoji',
    ]);
    if (types.status !== 0) {
      const output = detail(types);
      if (output !== '') console.error(output);
      failures.push(
        `${manifest.name}: attw found unresolved entry points in the packed tarball (warnings above)`,
      );
      continue;
    }
    checked.push(`${manifest.name} (publint, attw)`);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error('package hygiene check: FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`package hygiene check: OK (${checked.join(', ')})`);
