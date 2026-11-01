import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Writes build/release-notes.md from the CLI changelog section matching this
// app's version. electron-builder embeds it in latest*.yml, and the title
// bar's update card shows it.
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const changelog = readFileSync(resolve(root, '..', 'omnicode', 'CHANGELOG.md'), 'utf8');

const lines = changelog.split('\n');
const start = lines.findIndex((line) => line.trim() === `## ${version}`);
const section = [];
if (start !== -1) {
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    section.push(line);
  }
}

const HEADINGS = { 'Major Changes': 'Breaking changes', 'Minor Changes': 'New', 'Patch Changes': 'Fixes' };
const out = [];
for (const line of section) {
  const heading = /^### (.+)$/.exec(line.trim());
  if (heading) {
    out.push(`### ${HEADINGS[heading[1]] ?? heading[1]}`);
    continue;
  }
  if (!line.startsWith('- ')) continue;
  const text = line
    .slice(2)
    .replace(/^(\[#\d+\]\([^)]*\)\s*)?\[`[0-9a-f]+`\]\([^)]*\)\s*Thanks \[@[^\]]+\]\([^)]*\)!\s*-\s*/, '')
    .trim();
  if (text.length > 0) out.push(`- ${text}`);
}

const notes = out.some((line) => line.startsWith('- ')) ? out.join('\n') : 'Bug fixes and improvements.';
writeFileSync(resolve(root, 'build', 'release-notes.md'), `${notes}\n`);
console.log(`Release notes for ${version}: ${out.filter((l) => l.startsWith('- ')).length} items`);
