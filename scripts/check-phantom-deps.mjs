#!/usr/bin/env node
/**
 * Phantom-dependency guard: every bare import in a package's source must be
 * declared in that package's package.json. The reverse direction (declared but
 * unused) is covered by check-deps-consistency.mjs.
 *
 * Test-only imports may live in devDependencies; a bare import from src/ that
 * is declared only in devDependencies is a violation (it disappears from the
 * published package). Node builtins, relative paths, package-internal `#/`
 * aliases and `node:` specifiers are not bare dependencies.
 */
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const REPO_ROOT = import.meta.dirname.replace(/[\\/]scripts$/, '');
const ALLOWLIST_PATH = join(REPO_ROOT, 'scripts', 'phantom-deps-allowlist.json');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const SKIP_DIRECTORIES = new Set([
  'node_modules', 'dist', 'dist-web', '.turbo', 'coverage', 'build', '.git', '.tmp',
]);
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const SPECIFIER_RE =
  /\b(?:import|export)\s+(?:[^'";]*?\bfrom\s+)?(['"])([^'"]+)\1|(?<![\w$.])(?:import|require)\s*\(\s*(['"])([^'"]+)\3\s*\)/g;

/** Extract bare module specifiers from one source text (with 1-based lines). */
export function extractBareSpecifiers(text) {
  const found = [];
  for (const match of text.matchAll(SPECIFIER_RE)) {
    const specifier = match[2] ?? match[4];
    if (specifier === undefined || specifier.includes('${')) continue;
    const line = text.slice(0, match.index).split('\n').length;
    found.push({ specifier, line });
  }
  return found;
}

/** Map a module specifier to the package name that must be declared. */
export function packageNameOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) {
    return undefined;
  }
  if (specifier.startsWith('@/') || specifier.startsWith('~/')) return undefined;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (name === undefined || name === '' || BUILTINS.has(name) || BUILTINS.has(specifier)) {
    return undefined;
  }
  return name;
}

function workspaceDirs(root) {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split('\n');
  const globs = [];
  let inPackages = false;
  for (const line of yaml) {
    if (line.startsWith('packages:')) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[a-zA-Z]/.test(line)) break;
    if (!inPackages) continue;
    const entry = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (entry) globs.push(entry[1]);
  }
  const dirs = new Set();
  for (const glob of globs) {
    if (!glob.endsWith('/*')) {
      if (existsSync(join(root, glob, 'package.json'))) dirs.add(glob);
      continue;
    }
    const base = join(root, glob.slice(0, -2));
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (existsSync(join(base, name, 'package.json'))) dirs.add(`${glob.slice(0, -2)}/${name}`);
    }
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

function collectFiles(root, dir, pkgDir = dir, out = []) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) {
      if (existsSync(join(root, rel, 'package.json'))) continue;
      collectFiles(root, rel, pkgDir, out);
    } else if (
      SOURCE_EXTENSIONS.has(extname(entry)) &&
      relative(pkgDir, rel).split(sep)[0] === 'src'
    ) out.push(rel);
  }
  return out;
}

/**
 * Analyze a workspace. Returns { violations, scannedFiles, packages }, where
 * each violation is a plain object with dir, file, line, name and kind.
 */
export function analyzeWorkspace(root, allowlist = {}) {
  const violations = [];
  let scannedFiles = 0;
  const dirs = workspaceDirs(root);

  for (const dir of dirs) {
    const json = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
    const declared = new Set(
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .flatMap((field) => Object.keys(json[field] ?? {})),
    );

    const usages = new Map();
    for (const file of collectFiles(root, dir)) {
      scannedFiles += 1;
      const text = readFileSync(join(root, file), 'utf8');
      for (const { specifier, line } of extractBareSpecifiers(text)) {
        const name = packageNameOf(specifier);
        if (name === undefined) continue;
        const sites = usages.get(name) ?? [];
        sites.push({ file, line });
        usages.set(name, sites);
      }
    }

    for (const [name, sites] of [...usages].sort(([a], [b]) => a.localeCompare(b))) {
      if (declared.has(name) || name === json.name) continue;
      for (const site of sites.slice(0, 3)) {
        violations.push({
          dir, name, kind: 'phantom',
          file: relative(root, join(root, site.file)).split(sep).join('/'),
          line: site.line,
        });
      }
    }
  }

  const usedAllowlist = new Set();
  const effective = violations.filter((violation) => {
    const reason = allowlist[violation.name];
    if (typeof reason !== 'string' || reason.trim() === '') return true;
    usedAllowlist.add(violation.name);
    return false;
  });
  for (const name of Object.keys(allowlist)) {
    if (!usedAllowlist.has(name)) {
      effective.push({ dir: '(allowlist)', name, kind: 'stale-allowlist', file: ALLOWLIST_PATH, line: 0 });
    }
  }

  return { violations: effective, scannedFiles, packages: dirs.length };
}

function main() {
  const allowlist = existsSync(ALLOWLIST_PATH)
    ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
    : {};
  const { violations, scannedFiles, packages } = analyzeWorkspace(REPO_ROOT, allowlist);
  if (violations.length > 0) {
    process.stderr.write(`phantom dependency check: FAIL (${violations.length})\n`);
    for (const v of violations) {
      process.stderr.write(
        `  ${v.dir}: ${v.kind} import "${v.name}" at ${v.file}:${v.line}\n`,
      );
    }
    process.stderr.write(
      '  Declare the dependency in package.json (devDependencies for test-only imports),\n' +
        '  or add a dated reason to scripts/phantom-deps-allowlist.json.\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    `phantom dependency check: OK (${packages} packages, ${scannedFiles} source files)\n`,
  );
}

if (process.argv[1] && import.meta.filename.endsWith(relative(REPO_ROOT, process.argv[1]).replace(/\\/g, '/'))) {
  main();
}
