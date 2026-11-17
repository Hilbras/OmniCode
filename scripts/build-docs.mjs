#!/usr/bin/env node
// Renders the repository's documents to a static site, and — more importantly — checks
// them: every relative link must resolve and every translated page must have an English
// source (`docs/AGENTS.md`: English is the source of truth for `en/` + `zh/` pairs).
//
// Deliberately small: the workspace already renders markdown with `marked`, there is no
// site framework here, and `docs/` is documented as internal notes rather than a
// published guide. Adding a site generator dependency would buy navigation chrome this
// repository does not need — the plan (`docs/plans/strength-program.md`, T5.8) says to
// evaluate first, and this is the result of that evaluation.
//
// Usage:
//   node scripts/build-docs.mjs           build into docs-site/ and report problems
//   node scripts/build-docs.mjs --check   validate only (no writes) — used by check:guards
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { marked } from 'marked';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs-site');
const CHECK_ONLY = process.argv.includes('--check');

// Included: what a reader of this repository's documentation actually opens. Excluded on
// purpose: `docs/plans/**` and every `AGENTS.md` are agent-facing working notes, not docs.
const INCLUDE = [
  'README.md',
  'CONTRIBUTING.md',
  'docs/en',
  'docs/zh',
  'docs/release.md',
  'apps/omnicode-cli/README.md',
  'packages/API/docs/wire-contract.md',
];
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'dist-web', '.git', '.turbo', 'docs-site']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      out.push(...walk(full));
    } else if (extname(name) === '.md') {
      out.push(full);
    }
  }
  return out;
}

function collect() {
  const files = [];
  for (const entry of INCLUDE) {
    const full = join(ROOT, entry);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

const files = collect();
const rel = (f) => relative(ROOT, f).split('\\').join('/');
const problems = [];

// 1. Relative links resolve. A link to a directory is fine (readers browse the repo);
//    a link to a missing file or anchor target is not.
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const dir = dirname(file);
  for (const match of text.matchAll(/\]\((<?[^)\s>]+>?)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').trim();
    if (target === '' || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [pathPart] = target.split('#');
    if (pathPart === undefined || pathPart === '') continue;
    const resolved = resolve(dir, pathPart);
    if (!existsSync(resolved)) {
      problems.push(`${rel(file)}: link target does not exist: ${target}`);
    }
  }
}

// 2. Translation parity: every `docs/zh/<path>.md` needs `docs/en/<path>.md`, because
//    English is the source the Chinese mirror is written from.
for (const file of files) {
  const r = rel(file);
  const zhPrefix = 'docs/zh/';
  if (!r.startsWith(zhPrefix)) continue;
  const en = `docs/en/${r.slice(zhPrefix.length)}`;
  if (!files.some((f) => rel(f) === en)) {
    problems.push(`${r}: no English source at ${en} (docs/AGENTS.md: English is the source of truth)`);
  }
}

function page(title, body, depth) {
  const prefix = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${prefix}style.css">
<nav><a href="${prefix}index.html">OmniCode docs</a> · <code>${title}</code></nav>
<main>
${body}
</main>
`;
}

const CSS = `:root{color-scheme:light dark;--fg:#1b1b1f;--bg:#fff;--muted:#5b5b66;--line:#e3e3e8}
@media (prefers-color-scheme:dark){:root{--fg:#e6e6ea;--bg:#111113;--muted:#a0a0aa;--line:#2a2a30}}
body{margin:0 auto;max-width:52rem;padding:2rem 1.25rem 4rem;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--fg);background:var(--bg)}
nav{font-size:.9rem;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:.75rem;margin-bottom:1.5rem}
nav a{color:inherit}
a{color:#3b6ef6}code{background:color-mix(in srgb,var(--fg) 8%,transparent);padding:.1em .35em;border-radius:4px}
pre{background:color-mix(in srgb,var(--fg) 6%,transparent);padding:1rem;overflow:auto;border-radius:8px}
pre code{background:none;padding:0}table{border-collapse:collapse}th,td{border:1px solid var(--line);padding:.4rem .6rem}
blockquote{border-left:3px solid var(--line);margin:0;padding-left:1rem;color:var(--muted)}
`;

let written = 0;
if (!CHECK_ONLY) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'style.css'), CSS);
  for (const file of files) {
    const outPath = join(OUT, rel(file).replace(/\.md$/, '.html'));
    mkdirSync(dirname(outPath), { recursive: true });
    const depth = posix.normalize(rel(file)).split('/').length - 1;
    const html = marked.parse(readFileSync(file, 'utf8'), { async: false });
    writeFileSync(outPath, page(rel(file), html, depth));
    written += 1;
  }
  const nav = files
    .map((f) => `    <li><a href="${rel(f).replace(/\.md$/, '.html')}">${rel(f)}</a></li>`)
    .join('\n');
  writeFileSync(
    join(OUT, 'index.html'),
    page('OmniCode docs', `<ul>\n${nav}\n</ul>`, 0),
  );
}

console.log(`docs: ${files.length} markdown file(s), ${written} page(s) written to docs-site/`);
if (problems.length > 0) {
  console.error(`docs check: FAILED — ${problems.length} problem(s)`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log('docs check: OK (links resolve, translations have their English source)');
