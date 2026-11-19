import { describe, expect, it } from 'vitest';

import {
  allowClosure,
  findGrantCollisions,
  ruleTool,
} from '#/agent/permissionRules/ruleAliasClosure';

describe('ruleTool', () => {
  it('extracts the tool name from simple and argument-shaped patterns', () => {
    expect(ruleTool('Bash(npm test)')).toBe('Bash');
    expect(ruleTool('mcp__github__list_issues')).toBe('mcp__github__list_issues');
    expect(ruleTool('')).toBeUndefined();
  });
});

describe('allowClosure', () => {
  it('covers the edit family so an Edit grant cannot be switched to Write', () => {
    const closure = allowClosure('Edit(src/**)');
    expect(closure).toContain('Edit');
    expect(closure).toContain('Write');
    expect(closure).toContain('ApplyPatch');
  });

  it('covers monitor for Bash and leaves unknown tools alone', () => {
    expect(allowClosure('Bash(npm test)')).toContain('Monitor');
    expect(allowClosure('CustomTool')).toEqual(['CustomTool']);
  });

  it('does not widen MCP grants across servers', () => {
    expect(allowClosure('mcp__github__*')).toEqual(['mcp__github__*']);
  });
});

describe('findGrantCollisions', () => {
  it('reports an allow that collides with a deny in the same family', () => {
    expect(findGrantCollisions([
      { decision: 'allow', pattern: 'Edit(src/**)' },
      { decision: 'deny', pattern: 'Write(secrets/**)' },
    ])).toContainEqual({
      allowed: 'Write', byRule: 'Edit(src/**)', deniedBy: 'Write(secrets/**)',
    });
  });

  it('treats a Bash monitor grant and a Monitor deny as a collision', () => {
    expect(findGrantCollisions([
      { decision: 'allow', pattern: 'Bash(*)' },
      { decision: 'deny', pattern: 'Monitor' },
    ])).toContainEqual({ allowed: 'Monitor', byRule: 'Bash(*)', deniedBy: 'Monitor' });
  });

  it('returns nothing when denies and allows do not overlap', () => {
    expect(findGrantCollisions([
      { decision: 'allow', pattern: 'Read(**)' },
      { decision: 'deny', pattern: 'Bash(rm -rf *)' },
    ])).toEqual([]);
  });
});
