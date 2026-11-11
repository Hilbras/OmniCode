export const SKILL_COMMAND_PREFIX = 'skill:';

export function stripSkillPrefix(name: string): string {
  const bare = name.startsWith('/') ? name.slice(1) : name;
  return bare.startsWith(SKILL_COMMAND_PREFIX) ? bare.slice(SKILL_COMMAND_PREFIX.length) : bare;
}
