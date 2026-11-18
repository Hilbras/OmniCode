import { describe, expect, it } from 'vitest';

import { matchPermissionRule, parsePattern } from '#/agent/permissionRules/matchesRule';
import type { PermissionRule } from '#/agent/permissionRules/permissionRules';

function rule(pattern: string): PermissionRule {
  return { decision: 'allow', scope: 'user', pattern };
}

describe('typed permission patterns', () => {
  it('parses command, path, domain, and literal specifiers', () => {
    expect(parsePattern('Bash(command:git status*)')).toMatchObject({
      toolName: 'Bash',
      argPattern: 'git status*',
      specifierKind: 'command',
    });
    expect(parsePattern('Edit(path:src/**)')).toMatchObject({
      toolName: 'Edit',
      argPattern: 'src/**',
      specifierKind: 'path',
    });
    expect(parsePattern('WebFetch(domain:example.com)')).toMatchObject({
      toolName: 'WebFetch',
      argPattern: 'example.com',
      specifierKind: 'domain',
    });
    expect(parsePattern('Bash(git status)')).toEqual({
      toolName: 'Bash',
      argPattern: 'git status',
    });
  });

  it('matches a command specifier against the Bash command', () => {
    const input = { rule: rule('Bash(command:git status*)'), toolName: 'Bash', execution: {} };
    expect(matchPermissionRule({ ...input, args: { command: 'git status --short' } })?.strategy).toBe(
      'specifier_command',
    );
    expect(matchPermissionRule({ ...input, args: { command: 'rm -rf /' } })).toBeUndefined();
  });

  it('matches a path specifier against declared file accesses', () => {
    const input = { rule: rule('Edit(path:src/**)'), toolName: 'Edit', execution: {} };
    expect(
      matchPermissionRule({
        ...input,
        accesses: [{ kind: 'file', operation: 'write', path: '/workspace/src/a.ts' }],
      })?.strategy,
    ).toBe('specifier_path');
    expect(
      matchPermissionRule({
        ...input,
        accesses: [{ kind: 'file', operation: 'write', path: '/workspace/docs/a.md' }],
      }),
    ).toBeUndefined();
  });

  it('matches a domain specifier against URLs in the arguments', () => {
    const input = { rule: rule('WebFetch(domain:example.com)'), toolName: 'WebFetch', execution: {} };
    expect(matchPermissionRule({ ...input, args: { url: 'https://example.com/page' } })?.strategy).toBe(
      'specifier_domain',
    );
    expect(matchPermissionRule({ ...input, args: { url: 'https://evil.com/page' } })).toBeUndefined();
  });

  it('keeps the tool-specific matcher for unsuffixed patterns', () => {
    const match = matchPermissionRule({
      rule: rule('Bash(git *)'),
      toolName: 'Bash',
      execution: { matchesRule: (value) => value === 'git *' },
      args: { command: 'git status' },
    });
    expect(match?.strategy).toBe('matches_rule');
  });

  it('honours a wildcard tool and rejects a different tool', () => {
    const wildcard = rule('*(path:src/**)');
    const accesses = [{ kind: 'file' as const, operation: 'read' as const, path: '/ws/src/a.ts' }];
    expect(matchPermissionRule({ rule: wildcard, toolName: 'Read', execution: {}, accesses })).toBeDefined();
    const named = rule('Edit(path:src/**)');
    expect(matchPermissionRule({ rule: named, toolName: 'Read', execution: {}, accesses })).toBeUndefined();
  });
});
