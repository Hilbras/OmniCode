import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Writes build/release-notes.md from the CLI changelog section matching the
// bundled omnicode version. When the changelog has no section yet (changesets
// are still pending), the notes are composed from those pending changesets
// instead. electron-builder embeds the result in latest*.yml, and the title
// bar's update card shows it.

const root = resolve(import.meta.dirname, '..');
const omnicodeRoot = resolve(root, '..', 'omnicode');
const changesetDir = resolve(root, '..', '..', '.changeset');

// The changelog belongs to the omnicode package, so the section to publish is
// the one for the version bundled into this build - not the desktop app's own
// version, which advances independently.
const { version } = JSON.parse(
  readFileSync(resolve(omnicodeRoot, 'package.json'), 'utf8'),
);

const HEADINGS = { major: 'Breaking changes', minor: 'New', patch: 'Fixes' };

function stripLinks(line) {
  return line
    .slice(2)
    .replace(/^(\[#\d+\]\([^)]*\)\s*)?\[`[0-9a-f]+`\]\([^)]*\)\s*Thanks \[@[^\]]+\]\([^)]*\)!\s*-\s*/, '')
    .trim();
}

function fromChangelog() {
  const lines = readFileSync(resolve(omnicodeRoot, 'CHANGELOG.md'), 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return [];
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    section.push(line);
  }
  const out = [];
  for (const line of section) {
    const heading = /^### (.+)$/.exec(line.trim());
    if (heading) {
      out.push(`### ${HEADINGS[heading[1]] ?? heading[1]}`);
      continue;
    }
    if (!line.startsWith('- ')) continue;
    const text = stripLinks(line);
    if (text.length > 0) out.push(`- ${text}`);
  }
  return out;
}

function fromPendingChangesets(version) {
  const statePath = resolve(root, 'release-notes-announced.json');
  let state = { announced: {} };
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    state = { announced: {} };
  }
  const announced = state.announced ?? {};
  const entries = [];
  const pending = [];
  for (const file of readdirSync(changesetDir).toSorted()) {
    if (!file.endsWith('.md') || file === 'README.md') continue;
    const source = readFileSync(resolve(changesetDir, file), 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
    if (match === null) continue;
    const body = match[2].trim();
    if (body.length === 0) continue;
    const bumps = [...match[1].matchAll(/:\s*(major|minor|patch)\s*$/gm)].map((m) => m[1]);
    if (bumps.length === 0) continue;
    pending.push(file);
    // A changeset announced by the version being built stays in that version's
    // notes, so rebuilding the same version is deterministic. Anything
    // announced by an earlier version is old news and is left out.
    if (announced[file] !== undefined && announced[file] !== version) continue;
    const level = bumps.includes('major') ? 'major' : bumps.includes('minor') ? 'minor' : 'patch';
    entries.push({ level, text: body.replace(/\s+/g, ' ').trim() });
  }
  if (entries.length === 0) return [];
  const next = { announced: { ...announced } };
  for (const file of pending) next.announced[file] = version;
  writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`);
  const out = [];
  for (const level of ['major', 'minor', 'patch']) {
    const group = entries.filter((entry) => entry.level === level);
    if (group.length === 0) continue;
    out.push(`### ${HEADINGS[level]}`);
    for (const entry of group) out.push(`- ${entry.text}`);
    out.push('');
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

const out = fromChangelog();
const usedChangesets = out.length === 0;
if (usedChangesets) out.push(...fromPendingChangesets(version));

const notes = out.some((line) => line.startsWith('- '))
  ? out.join('\n')
  : 'Bug fixes and improvements.';
writeFileSync(resolve(root, 'build', 'release-notes.md'), `${notes}\n`);
const items = out.filter((line) => line.startsWith('- ')).length;
console.log(
  `Release notes for ${version}: ${items} item(s)${usedChangesets ? ' from pending changesets' : ' from the changelog'}`,
);
