import picomatch from 'picomatch';

import { Error2, ErrorCodes } from '#/errors';
import { globMatch, pathGlobMatch } from '#/tool/rule-match';
import type { RunnableToolExecution, ToolAccesses } from '#/tool/toolContract';
import type { PermissionRule } from './permissionRules';

export type PermissionSpecifierKind = 'command' | 'path' | 'domain' | 'literal';

export interface ParsedPattern {
  readonly toolName: string;
  readonly argPattern?: string;
  readonly specifierKind?: PermissionSpecifierKind;
}

export type ParsedPermissionPattern = ParsedPattern;

export interface PermissionRuleMatchExecution {
  readonly matchesRule?: RunnableToolExecution['matchesRule'];
}

export type PermissionRuleMatchStrategy =
  | 'tool_name_only'
  | 'matches_rule'
  | 'specifier_command'
  | 'specifier_path'
  | 'specifier_domain';

export interface PermissionRuleMatch {
  readonly rule: PermissionRule;
  readonly strategy: PermissionRuleMatchStrategy;
  readonly hasRuleArgs: boolean;
}

export interface PermissionRuleMatchInput {
  readonly rule: PermissionRule;
  readonly toolName: string;
  readonly execution: PermissionRuleMatchExecution;
  readonly args?: unknown;
  readonly accesses?: ToolAccesses;
}

const SPECIFIER = /^(command|path|domain|literal):(.*)$/s;

export function parsePattern(pattern: string): ParsedPattern {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    throw new Error2(ErrorCodes.VALIDATION_FAILED, 'permission pattern: empty string');
  }

  const openIdx = trimmed.indexOf('(');
  if (openIdx === -1) {
    return { toolName: trimmed };
  }

  if (!trimmed.endsWith(')')) {
    throw new Error2(ErrorCodes.VALIDATION_FAILED, `permission pattern: missing closing paren in "${pattern}"`);
  }

  const toolName = trimmed.slice(0, openIdx);
  const rawArg = trimmed.slice(openIdx + 1, -1);
  if (toolName.length === 0) {
    throw new Error2(ErrorCodes.VALIDATION_FAILED, `permission pattern: empty tool name in "${pattern}"`);
  }
  if (rawArg.length === 0) {
    return { toolName };
  }
  const specifier = SPECIFIER.exec(rawArg);
  if (specifier !== null && specifier[2] !== undefined && specifier[2].length > 0) {
    return {
      toolName,
      argPattern: specifier[2],
      specifierKind: specifier[1] as PermissionSpecifierKind,
    };
  }
  return { toolName, argPattern: rawArg };
}

export const parsePermissionPattern = parsePattern;

export function matchPermissionRule({
  rule,
  toolName,
  execution,
  args,
  accesses,
}: PermissionRuleMatchInput): PermissionRuleMatch | undefined {
  let parsed;
  try {
    parsed = parsePattern(rule.pattern);
  } catch {
    return undefined;
  }

  if (parsed.toolName !== '*' && !picomatch.isMatch(toolName, parsed.toolName)) {
    return undefined;
  }

  if (parsed.argPattern === undefined) {
    return { rule, strategy: 'tool_name_only', hasRuleArgs: false };
  }

  if (parsed.specifierKind === 'command') {
    const command = stringField(args, 'command');
    if (command !== undefined && globMatch(command, parsed.argPattern)) {
      return { rule, strategy: 'specifier_command', hasRuleArgs: true };
    }
    return undefined;
  }

  if (parsed.specifierKind === 'path') {
    const paths = (accesses ?? []).flatMap((access) => (access.kind === 'file' ? [access.path] : []));
    if (
      paths.some(
        (path) =>
          pathGlobMatch(path, parsed.argPattern as string) ||
          pathGlobMatch(path, `**/${parsed.argPattern as string}`),
      )
    ) {
      return { rule, strategy: 'specifier_path', hasRuleArgs: true };
    }
    return undefined;
  }

  if (parsed.specifierKind === 'domain') {
    const domains = urlsOf(args).map((url) => hostOf(url)).filter((host): host is string => host !== undefined);
    if (domains.some((domain) => globMatch(domain, parsed.argPattern as string, { nocase: true }))) {
      return { rule, strategy: 'specifier_domain', hasRuleArgs: true };
    }
    return undefined;
  }

  return execution.matchesRule?.(parsed.argPattern) === true
    ? { rule, strategy: 'matches_rule', hasRuleArgs: true }
    : undefined;
}

function stringField(args: unknown, key: string): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function urlsOf(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => urlsOf(item, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap((item) => urlsOf(item, depth + 1));
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}
