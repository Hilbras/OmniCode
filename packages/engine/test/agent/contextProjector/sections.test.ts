import { describe, expect, it } from 'vitest';

import { diffContextSections, projectContextSections } from '#/agent/contextProjector/sections';

const base = [
  { id: 'workspace', title: 'Workspace', content: 'branch: main' },
  { id: 'tools', title: 'Tools', content: 'bash: enabled' },
];

describe('context section projection', () => {
  it('emits nothing when sections are unchanged', () => {
    const projection = projectContextSections(base, base);
    expect(projection.changed).toBe(false);
    expect(projection.text).toBe('');
  });

  it('detects added, updated, and removed sections', () => {
    const delta = diffContextSections(base, [
      { id: 'workspace', title: 'Workspace', content: 'branch: feat' },
      { id: 'memory', title: 'Memory', content: 'Hassan' },
    ]);
    expect(delta.added.map((section) => section.id)).toEqual(['memory']);
    expect(delta.updated.map((section) => section.id)).toEqual(['workspace']);
    expect(delta.removed.map((section) => section.id)).toEqual(['tools']);
  });

  it('renders stable machine-readable transitions', () => {
    const projection = projectContextSections(base, [
      { id: 'workspace', title: 'Workspace', content: 'branch: feat' },
      { id: 'memory', title: 'Memory "profile"', content: 'Hassan' },
    ]);
    expect(projection.text).toContain('action="ADD" id="memory"');
    expect(projection.text).toContain('title="Memory &quot;profile&quot;"');
    expect(projection.text).toContain('action="UPDATE" id="workspace"');
    expect(projection.text).toContain('action="REMOVE" id="tools"');
  });

  it('keeps output deterministic by current order, then removals', () => {
    const projection = projectContextSections(
      [{ id: 'a', content: '1' }, { id: 'b', content: '2' }],
      [{ id: 'b', content: '2' }, { id: 'c', content: '3' }],
    );
    expect(projection.text.indexOf('id="c"')).toBeLessThan(projection.text.indexOf('id="a"'));
  });
});
