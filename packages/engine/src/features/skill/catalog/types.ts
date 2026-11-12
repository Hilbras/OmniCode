export type SkillSource = 'project' | 'user' | 'extra' | 'builtin';

export type SkillScope = 'tui' | 'web';

export interface SkillMetadata {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly type?: string | undefined;
  readonly whenToUse?: string | undefined;
  readonly disableModelInvocation?: boolean | undefined;
  readonly isSubSkill?: boolean | undefined;
  readonly safe?: boolean | undefined;
  readonly allowedTools?: readonly string[] | undefined;
  readonly disallowedTools?: readonly string[] | undefined;
  readonly arguments?: readonly unknown[] | string | undefined;
  readonly [key: string]: unknown;
}

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly dir: string;
  readonly content: string;
  readonly metadata: SkillMetadata;
  readonly source: SkillSource;
  readonly plugin?: SkillPluginContext;
  readonly mermaid?: string | undefined;
  readonly d2?: string;
  readonly productSpecific?: boolean;
  readonly scopes?: readonly SkillScope[];
  readonly experimentalFlag?: string;
}

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly source: SkillSource;
  readonly type?: string | undefined;
  readonly disableModelInvocation?: boolean | undefined;
  readonly isSubSkill?: boolean | undefined;
  readonly scopes?: readonly SkillScope[];
}

export interface SkillRoot {
  readonly path: string;
  readonly source: SkillSource;
  readonly plugin?: SkillPluginContext;
  readonly scanMode?: 'directory' | 'root-skill-only';
}

export interface SkillPluginContext {
  readonly id: string;
  readonly instructions?: string;
}

export interface SkippedSkill {
  readonly path: string;
  readonly type: string;
  readonly reason: string;
}

export interface SkillCatalog {
  getSkill(name: string): SkillDefinition | undefined;
  getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined;
  renderSkillPrompt(
    skill: SkillDefinition,
    rawArgs: string,
    context?: { readonly sessionId?: string },
  ): string;
  listSkills(): readonly SkillDefinition[];
  listInvocableSkills(): readonly SkillDefinition[];
  getSkillRoots(): readonly string[];
  getSkippedByPolicy(): readonly SkippedSkill[];
  getModelSkillListing(): string;
}

export function normalizeSkillName(name: string): string {
  return name.toLowerCase();
}

export function isInlineSkillType(type: string | undefined): boolean {
  return type === undefined || type === 'prompt' || type === 'inline';
}

export function isUserActivatableSkillType(type: string | undefined): boolean {
  return isInlineSkillType(type) || type === 'flow';
}

export function isSupportedSkillType(type: string | undefined): boolean {
  return isUserActivatableSkillType(type) || type === 'reference';
}

export function summarizeSkill(skill: SkillDefinition): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    type: skill.metadata.type,
    disableModelInvocation: skill.metadata.disableModelInvocation,
    isSubSkill: skill.metadata.isSubSkill,
    scopes: skill.scopes,
  };
}


export function normalizeToolList(value: unknown): readonly string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const tools = raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return tools.length === 0 ? undefined : [...new Set(tools)];
}

export function skillAllowsTool(skill: Pick<SkillDefinition, 'metadata'>, toolName: string): boolean {
  const denied = skill.metadata.disallowedTools;
  if (denied !== undefined && denied.some((pattern) => matchesTool(pattern, toolName))) return false;
  const allowed = skill.metadata.allowedTools;
  return allowed === undefined || allowed.some((pattern) => matchesTool(pattern, toolName));
}

function matchesTool(pattern: string, toolName: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return toolName.startsWith(pattern.slice(0, -1));
  return pattern === toolName;
}
