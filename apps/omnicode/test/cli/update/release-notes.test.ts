import { notesBetweenSections, parseChangelogSections } from '#/cli/update/release-notes';
import { describe, expect, it } from 'vitest';

function commitLine(hash: string, message: string): string {
  return `- [${hash}](https://github.com/Hilbras/Omnicode/commit/${hash}00) Thanks [@maintainer](https://github.com/maintainer)! - ${message}`;
}

function buildFixture(): string {
  const parts = [
    '# @hilbras/omnicode',
    '',
    '## 1.2.1',
    '',
    '### Patch Changes',
    '',
    commitLine('c7db83c', 'Publish through a dedicated release workflow instead of a root publish lifecycle hook.'),
    '',
    commitLine('bd5a463', 'Write the embedded database magic as code units instead of byte values.'),
    '',
    '## 1.2.0',
    '',
    '### Minor Changes',
    '',
    commitLine('1c1299a', 'Change the /mcp command into an interactive manager.'),
    '',
    commitLine('8084553', 'Add experimental persistent memory.'),
    '',
    '### Patch Changes',
    '',
    commitLine('be249a4', 'Fix conversations failing after an interrupted tool call.'),
    '',
    '## 1.1.0',
    '',
    '### Minor Changes',
    '',
    commitLine('aaaaaaa', 'Add the /connectors command.'),
  ];
  return parts.join('\n');
}

const FIXTURE = buildFixture();

describe('parseChangelogSections', () => {
  it('extracts version sections newest-first with commit links stripped', () => {
    const sections = parseChangelogSections(FIXTURE);
    expect(sections.map((s) => s.version)).toEqual(['1.2.1', '1.2.0', '1.1.0']);
    expect(sections[0]!.items).toEqual([
      'Publish through a dedicated release workflow instead of a root publish lifecycle hook.',
      'Write the embedded database magic as code units instead of byte values.',
    ]);
    // Both the minor and the patch bullet groups of one version land in one section.
    expect(sections[1]!.items).toHaveLength(3);
    expect(sections[1]!.items[0]).toContain('/mcp');
    expect(sections[1]!.items[2]).toContain('interrupted tool call');
  });

  it('returns no sections for empty input', () => {
    expect(parseChangelogSections('')).toEqual([]);
  });

  it('ignores prose lines that are not release bullets', () => {
    const md = [
      '## 2.0.0',
      '',
      'Some narrative line that is not a changeset bullet.',
      commitLine('x', 'Ship the big thing.'),
      '',
    ].join('\n');
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items).toEqual(['Ship the big thing.']);
  });
});

describe('notesBetweenSections', () => {
  const sections = parseChangelogSections(FIXTURE);

  it('includes only versions strictly between from (exclusive) and to (inclusive)', () => {
    const result = notesBetweenSections(sections, '1.1.0', '1.2.1');
    expect(result.sections.map((s) => s.version)).toEqual(['1.2.1', '1.2.0']);
    expect(result.omittedItems).toBe(0);
  });

  it('excludes the target version when it is not the newest section', () => {
    const result = notesBetweenSections(sections, '1.1.0', '1.2.0');
    expect(result.sections.map((s) => s.version)).toEqual(['1.2.0']);
  });

  it('returns nothing when from equals to', () => {
    const result = notesBetweenSections(sections, '1.2.1', '1.2.1');
    expect(result.sections).toEqual([]);
  });

  it('includes every section when fromVersion predates all of them', () => {
    const result = notesBetweenSections(sections, '0.5.0', '1.2.1');
    expect(result.sections.map((s) => s.version)).toEqual(['1.2.1', '1.2.0', '1.1.0']);
  });

  it('caps total items and reports the omitted count', () => {
    const big = [
      { version: '9.0.2', items: Array.from({ length: 40 }, (_, j) => `newest ${String(j)}`) },
      { version: '9.0.1', items: Array.from({ length: 40 }, (_, j) => `middle ${String(j)}`) },
      { version: '9.0.0', items: Array.from({ length: 40 }, (_, j) => `oldest ${String(j)}`) },
    ];
    const result = notesBetweenSections(big, '8.0.0', '9.0.2');
    // 9.0.0 and 9.0.1 sit strictly between 8.0.0 and 9.0.2, so all three
    // sections are in range; only the newest fills the 30-item budget.
    expect(result.sections.map((s) => s.version)).toEqual(['9.0.2']);
    expect(result.sections[0]!.items).toHaveLength(30);
    expect(result.sections[0]!.items[0]).toBe('newest 0');
    expect(result.omittedItems).toBe(90);
  });

  it('skips sections whose versions are not valid semver relative to the range', () => {
    const mixed = [...sections, { version: 'unreleased-dev', items: ['work in progress'] }];
    const result = notesBetweenSections(mixed, '1.1.0', '1.2.1');
    expect(result.sections.map((s) => s.version)).toEqual(['1.2.1', '1.2.0']);
  });
});
