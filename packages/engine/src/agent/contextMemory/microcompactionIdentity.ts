/**
 * Fail-closed microcompaction identity (unified plan B3).
 *
 * A reused tool-call id with an unparseable sibling must fail closed rather than
 * guessing which path to evict; all parseable paths for a call are accumulated
 * and deliberately over-disarmed (a redundant re-read is cheaper than a
 * dangling placeholder). Reference: qwen `microcompact.ts:194-290`.
 */
export interface ToolCallIdentity {
  readonly id: string;
  readonly name: string;
  readonly parseable: boolean;
  readonly paths: readonly string[];
}

export interface EvictionPathResolution {
  readonly paths: readonly string[];
  readonly failedClosed: boolean;
  readonly reason: string;
}

export function resolveEvictionPaths(
  calls: readonly ToolCallIdentity[],
): EvictionPathResolution {
  if (calls.length === 0) {
    return { paths: [], failedClosed: false, reason: 'no tool calls' };
  }
  const byId = new Map<string, ToolCallIdentity[]>();
  for (const call of calls) {
    const group = byId.get(call.id) ?? [];
    group.push(call);
    byId.set(call.id, group);
  }

  const paths = new Set<string>();
  let unparseableSiblings = false;
  for (const group of byId.values()) {
    if (group.some((call) => !call.parseable)) {
      unparseableSiblings = true;
      continue;
    }
    for (const call of group) {
      for (const path of call.paths) paths.add(path);
    }
  }

  if (unparseableSiblings) {
    return {
      paths: [], failedClosed: true,
      reason: 'unparseable sibling with a reused call id; refusing to guess eviction paths',
    };
  }
  return {
    paths: [...paths].sort(), failedClosed: false,
    reason: paths.size === 0 ? 'no file paths in tool calls' : 'all parseable paths accumulated',
  };
}
