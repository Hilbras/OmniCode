import { describe, expect, it } from 'vitest';

import {
  normalizeToolName,
  resolveGrantAmbiguity,
  type ToolClaim,
} from '#/mcpCore/grantAmbiguity';

const github: ToolClaim = { name: 'list_issues', server: 'github', aliases: ['list-issues'] };
const gitlab: ToolClaim = { name: 'list_issues', server: 'gitlab' };

describe('normalizeToolName', () => {
  it('normalizes mcp prefixes, case and separators', () => {
    expect(normalizeToolName('mcp__GitHub__List-Issues')).toBe('github_list_issues');
  });
});

describe('resolveGrantAmbiguity', () => {
  it('grants a unique claimant', () => {
    const result = resolveGrantAmbiguity({ pattern: 'list_issues', decision: 'allow' }, [github]);
    expect(result.status).toBe('granted');
    expect(result.claimants).toEqual(['list_issues']);
  });

  it('refuses an allow rule when two servers claim the same tool', () => {
    const result = resolveGrantAmbiguity({ pattern: 'list_issues', decision: 'allow' }, [github, gitlab]);
    expect(result.status).toBe('refused-ambiguous');
    expect(result.claimants).toEqual(['list_issues', 'list_issues']);
  });

  it('applies deny rules to every claimant', () => {
    const result = resolveGrantAmbiguity({ pattern: 'list_issues', decision: 'deny' }, [github, gitlab]);
    expect(result.status).toBe('denied');
  });

  it('reports no match for an unclaimed tool', () => {
    expect(resolveGrantAmbiguity({ pattern: 'unknown', decision: 'allow' }, [github]).status)
      .toBe('no-match');
  });
});
