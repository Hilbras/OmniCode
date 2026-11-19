/**
 * Alias-closed permission rules (WS4.8 / Q9).
 *
 * A rule naming a tool must also cover the tools the model can switch to for
 * the same effect. Otherwise an `Edit` allow rule is trivially bypassed by
 * `Write`, or a `Bash` allow rule by the background monitor. Denies are never
 * widened: alias closure applies only to allow rules.
 */
export const TOOL_ALIAS_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  Edit: ['Edit', 'Write', 'ApplyPatch', 'NotebookEdit', 'RestoreFile'],
  Bash: ['Bash', 'Monitor'],
  Read: ['Read', 'ReadMediaFile', 'Lsp'],
  WebSearch: ['WebSearch', 'FetchURL'],
  Task: ['TaskList', 'TaskOutput', 'TaskStop', 'WaitFor'],
};

export function ruleTool(pattern: string): string | undefined {
  return /^([A-Za-z_][\w.*-]*)/.exec(pattern.trim())?.[1];
}

/** Tools an allow rule for `pattern` effectively grants. */
export function allowClosure(pattern: string): readonly string[] {
  const tool = ruleTool(pattern);
  if (tool === undefined) return [];
  if (tool.startsWith('mcp__')) return [tool];
  return TOOL_ALIAS_FAMILIES[tool] ?? [tool];
}

export interface GrantCollision {
  readonly allowed: string;
  readonly byRule: string;
  readonly deniedBy?: string;
}

/**
 * Finds collisions between allow grants and explicit denies. A deny for any
 * member of an allow rule's alias family beats the allow — the narrower
 * restriction must never be widened by a generic rule.
 */
export function findGrantCollisions(
  rules: readonly { readonly decision: 'allow' | 'deny'; readonly pattern: string }[],
): readonly GrantCollision[] {
  const denies = rules.filter((rule) => rule.decision === 'deny');
  const collisions: GrantCollision[] = [];
  for (const rule of rules.filter((candidate) => candidate.decision === 'allow')) {
    for (const allowed of allowClosure(rule.pattern)) {
      const deny = denies.find((candidate) =>
        allowClosure(candidate.pattern).includes(allowed) ||
        candidate.pattern === allowed ||
        candidate.pattern.startsWith(`${allowed}(`),
      );
      if (deny !== undefined) {
        collisions.push({ allowed, byRule: rule.pattern, deniedBy: deny.pattern });
      }
    }
  }
  return collisions;
}
