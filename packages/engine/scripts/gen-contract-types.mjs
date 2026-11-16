import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
// oxlint-disable-next-line typescript/no-unused-vars -- import.meta.url needs the helper
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

const __dirname = import.meta.dirname;
const PKG = join(__dirname, '..');
const SRC = join(PKG, 'src');
const TMP = join(PKG, '.contract-types-tmp');
const TSCONFIG = join(PKG, 'tsconfig.contract.json');
const DIGEST_PATH = join(PKG, 'docs', 'contract-types.sha256');

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const checkOnly = argv.includes('--check');
const outArg = argv.find((arg) => !arg.startsWith('--'));

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

function log(msg) {
  console.log(`[gen-contract-types] ${msg}`);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function renderDigest(root) {
  const files = [];
  walk(root, files);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    files
      .map((file) => {
        const rel = relative(root, file).split(sep).join('/');
        const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
        return `${hash}  ${rel}`;
      })
      .join('\n') + '\n'
  );
}

function digestEntries(text) {
  const entries = new Map();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const at = line.indexOf('  ');
    if (at < 0) continue;
    entries.set(line.slice(at + 2), line.slice(0, at));
  }
  return entries;
}

function reportDigestDrift(current, next) {
  const before = digestEntries(current);
  const after = digestEntries(next);
  const changed = [];
  const added = [];
  const removed = [];
  for (const [file, hash] of after) {
    const previous = before.get(file);
    if (previous === undefined) added.push(file);
    else if (previous !== hash) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);
  log(
    `contract declaration drift: ${String(changed.length)} changed, ${String(added.length)} added, ${String(removed.length)} removed`,
  );
  for (const file of [...changed, ...added].slice(0, 10)) log(`  changed: ${file}`);
  for (const file of removed.slice(0, 10)) log(`  removed: ${file}`);
  const total = changed.length + added.length + removed.length;
  if (total > 20) log(`  ... ${String(total - 20)} more`);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
log(`emitting declarations via tsc -> ${relative(PKG, TMP)}`);
try {
  execFileSync(process.execPath, [tscBin, '-p', TSCONFIG, '--outDir', TMP], {
    cwd: PKG,
    stdio: 'pipe',
  });
} catch (error) {
  const code = error && typeof error === 'object' && 'status' in error ? error.status : 'unknown';
  log(`tsc exited ${String(code)} (non-fatal; declarations are still emitted)`);
}

log('scanning for registerScopedService(...) bindings');
const project = new Project();
project.addSourceFilesAtPaths(join(SRC, '**', '*.ts'));

const dropByDts = new Map();
const implFiles = [];

for (const sf of project.getSourceFiles()) {
  const calls = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((c) => c.getExpression().getText() === 'registerScopedService');
  if (calls.length === 0) continue;

  implFiles.push(sf.getFilePath());
  const names = new Set();
  for (const call of calls) {
    const args = call.getArguments();
    if (args.length < 3) continue;
    const text = args[2].getText().trim();
    names.add(/^[A-Za-z_$][\w$]*$/.test(text) ? text : '*');
  }

  const rel = relative(SRC, sf.getFilePath()).replace(/\.ts$/, '.d.ts');
  const dtsPath = join(TMP, rel);
  const existing = dropByDts.get(dtsPath) ?? new Set();
  for (const n of names) existing.add(n);
  dropByDts.set(dtsPath, existing);
}

log(`found ${implFiles.length} impl files`);

let scrubbedFiles = 0;
let scrubbedClasses = 0;
for (const [dtsPath, names] of dropByDts) {
  if (!existsSync(dtsPath)) continue;
  const dtsProject = new Project();
  const dts = dtsProject.addSourceFileAtPath(dtsPath);
  const dropAll = names.has('*');
  let removed = 0;
  for (const cls of dts.getClasses()) {
    const clsName = cls.getName();
    if (dropAll || (clsName !== undefined && names.has(clsName))) {
      cls.remove();
      removed++;
    }
  }
  if (removed > 0) {
    dts.saveSync();
    scrubbedFiles++;
    scrubbedClasses += removed;
  }
}
log(`scrubbed ${scrubbedClasses} impl class(es) across ${scrubbedFiles} file(s)`);

function resolveReexportTarget(dtsPath, spec) {
  const clean = spec.endsWith('.js') ? spec.slice(0, -'.js'.length) : spec;
  if (clean.startsWith('.')) return join(dirname(dtsPath), `${clean}.d.ts`);
  if (clean.startsWith('#/')) return join(TMP, `${clean.slice(2)}.d.ts`);
  return undefined;
}

let scrubbedReexports = 0;
const emittedDts = [];
walk(TMP, emittedDts);
const reexportProject = new Project();
for (const dtsPath of emittedDts) {
  if (!dtsPath.endsWith('.d.ts')) continue;
  const dts = reexportProject.addSourceFileAtPath(dtsPath);
  let changed = false;
  for (const exp of dts.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (spec === undefined) continue;
    const target = resolveReexportTarget(dtsPath, spec);
    const names = target === undefined ? undefined : dropByDts.get(target);
    if (names === undefined) continue;
    let removedHere = false;
    for (const specifier of exp.getNamedExports()) {
      const name = specifier.getNameNode().getText();
      if (names.has('*') || names.has(name)) {
        specifier.remove();
        removedHere = true;
        scrubbedReexports++;
      }
    }
    if (removedHere && exp.getNamedExports().length === 0) exp.remove();
    changed = changed || removedHere;
  }
  if (changed) dts.saveSync();
}
log(`scrubbed ${scrubbedReexports} re-export(s) of impl classes from alias modules`);

const leaked = [];
for (const [dtsPath, names] of dropByDts) {
  if (!existsSync(dtsPath) || names.has('*')) continue;
  const text = readFileSync(dtsPath, 'utf8');
  for (const n of names) {
    const re = new RegExp(`declare\\s+class\\s+${n}\\b`);
    if (re.test(text)) leaked.push(`${relative(TMP, dtsPath)} still declares ${n}`);
  }
}

const emitted = [];
walk(TMP, emitted);
const dtsCount = emitted.filter((f) => f.endsWith('.d.ts')).length;
const digest = renderDigest(TMP);

if (outArg !== undefined) {
  const out = join(process.cwd(), outArg);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(dirname(out), { recursive: true });
  cpSync(TMP, out, { recursive: true });
  log(`copied ${dtsCount} declaration file(s) -> ${out}`);
}

if (checkOnly) {
  let current = '';
  try {
    current = readFileSync(DIGEST_PATH, 'utf-8');
  } catch {
    current = '';
  }
  if (current !== digest) {
    if (current === '') {
      log(`${relative(PKG, DIGEST_PATH)} is missing; regenerate to record the contract digest`);
    } else {
      reportDigestDrift(current, digest);
    }
    process.exitCode = 1;
  } else {
    log(`contract types are fresh (${dtsCount} declaration files)`);
  }
} else {
  writeFileSync(DIGEST_PATH, digest);
  log(`recorded ${dtsCount} declaration hash(es) -> ${relative(PKG, DIGEST_PATH)}`);
}

if (leaked.length > 0) {
  log(`FAILED: ${leaked.length} registered impl class(es) survive the contract scrub:`);
  for (const l of leaked) log(`  - ${l}`);
  process.exitCode = 1;
} else {
  log('leak check passed: no registered impl class survives in its declaring file');
}

rmSync(TMP, { recursive: true, force: true });
