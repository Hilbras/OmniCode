import { describe, expect, it } from 'vitest';

import {
  isInlineSkillType,
  isSupportedSkillType,
  isUserActivatableSkillType,
  normalizeSkillName,
  normalizeToolList,
  skillAllowsTool,
  summarizeSkill,
} from '#/features/skill/catalog/types';
import type { SkillDefinition } from '#/features/skill/catalog/types';

describe('skill/types', () => {
  it('normalizeSkillName lowercases', () => {
    expect(normalizeSkillName('CoMmIt')).toBe('commit');
  });

  it('isInlineSkillType treats undefined/prompt/inline as inline', () => {
    expect(isInlineSkillType(undefined)).toBe(true);
    expect(isInlineSkillType('prompt')).toBe(true);
    expect(isInlineSkillType('inline')).toBe(true);
    expect(isInlineSkillType('flow')).toBe(false);
  });

  it('isUserActivatableSkillType includes flow', () => {
    expect(isUserActivatableSkillType('flow')).toBe(true);
    expect(isUserActivatableSkillType('reference')).toBe(false);
  });

  it('isSupportedSkillType includes reference', () => {
    expect(isSupportedSkillType('reference')).toBe(true);
    expect(isSupportedSkillType('unknown')).toBe(false);
  });

  it('summarizeSkill projects the public fields', () => {
    const skill: SkillDefinition = {
      name: 'commit',
      description: 'Commit helper',
      path: '/skills/commit',
      source: 'user',
      metadata: { type: 'prompt', disableModelInvocation: false, isSubSkill: false },
    } as unknown as SkillDefinition;
    expect(summarizeSkill(skill)).toEqual({
      name: 'commit',
      description: 'Commit helper',
      path: '/skills/commit',
      source: 'user',
      type: 'prompt',
      disableModelInvocation: false,
      isSubSkill: false,
    });
  });

  it('normalizes allowed/disallowed tool lists and matches wildcards', () => {
    expect(normalizeToolList('Read, Edit, Read')).toEqual(['Read', 'Edit']);
    expect(normalizeToolList(['Bash*', 'Lsp'])).toEqual(['Bash*', 'Lsp']);
    const skill = {
      metadata: { allowedTools: ['Read', 'mcp__*'], disallowedTools: ['mcp__unsafe'] },
    } as unknown as SkillDefinition;
    expect(skillAllowsTool(skill, 'Read')).toBe(true);
    expect(skillAllowsTool(skill, 'mcp__github__list')).toBe(true);
    expect(skillAllowsTool(skill, 'mcp__unsafe')).toBe(false);
    expect(skillAllowsTool(skill, 'Bash')).toBe(false);
  });
});
