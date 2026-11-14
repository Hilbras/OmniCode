/**
 * Speculation risk gate.
 *
 * While a speculative branch is armed, every tool call is classified before
 * it can run:
 *
 * - `allowed` — read-only tools that observe the workspace without mutating
 *   anything; they run normally.
 * - `overlay` — whole-file writes the branch can capture in its overlay
 *   instead of executing.
 * - `refused` — everything else. Fail-closed: a tool the gate does not know
 *   is refused, not waved through, because a speculative run must never be
 *   able to cause an effect the accept/discard decision cannot see or undo.
 *
 * The gate is a restriction only. It never approves a call on the model's
 * behalf; approved/asked calls still flow through the normal permission
 * chain, and refusals happen before any side effect.
 */

export type SpeculationToolVerdict =
  | { readonly verdict: 'allowed' }
  | { readonly verdict: 'overlay' }
  | { readonly verdict: 'refused'; readonly reason: SpeculationRefusalReason };

export type SpeculationRefusalReason =
  | 'process-execution'
  | 'network-egress'
  | 'file-mutation-not-overlayable'
  | 'external-state-mutation'
  | 'agent-spawn'
  | 'user-interaction'
  | 'persistent-state-mutation'
  | 'server-defined-tool'
  | 'unknown-tool';

const OVERLAY_TOOLS = new Set<string>(['Write']);

const ALLOWED_TOOLS = new Set<string>([
  'Read',
  'Grep',
  'Glob',
  'Lsp',
  'GetGoal',
  'CronList',
  'WorktreeList',
  'TeamList',
  'TaskBoardList',
  'SearchSessions',
]);

const REFUSAL_BY_TOOL: ReadonlyMap<string, SpeculationRefusalReason> = new Map([
  ['Bash', 'process-execution'],
  ['FetchURL', 'network-egress'],
  ['WebSearch', 'network-egress'],
  ['Edit', 'file-mutation-not-overlayable'],
  ['ApplyPatch', 'file-mutation-not-overlayable'],
  ['NotebookEdit', 'file-mutation-not-overlayable'],
  ['RestoreFile', 'file-mutation-not-overlayable'],
  ['WorktreeCreate', 'external-state-mutation'],
  ['WorktreeRemove', 'external-state-mutation'],
  ['CronCreate', 'persistent-state-mutation'],
  ['CronDelete', 'persistent-state-mutation'],
  ['TaskBoardCreate', 'external-state-mutation'],
  ['TaskBoardUpdate', 'external-state-mutation'],
  ['TeamCreate', 'external-state-mutation'],
  ['TeamJoin', 'external-state-mutation'],
  ['TeamLeave', 'external-state-mutation'],
  ['AgentSwarm', 'agent-spawn'],
  ['Skill', 'agent-spawn'],
  ['AskUserQuestion', 'user-interaction'],
  ['ArtifactRecord', 'external-state-mutation'],
  ['SourceRecord', 'external-state-mutation'],
  ['CreateGoal', 'persistent-state-mutation'],
  ['UpdateGoal', 'persistent-state-mutation'],
  ['SetGoalBudget', 'persistent-state-mutation'],
]);

export function classifySpeculationTool(toolName: string): SpeculationToolVerdict {
  if (OVERLAY_TOOLS.has(toolName)) return { verdict: 'overlay' };
  if (ALLOWED_TOOLS.has(toolName)) return { verdict: 'allowed' };
  if (toolName.startsWith('mcp__')) return { verdict: 'refused', reason: 'server-defined-tool' };
  const known = REFUSAL_BY_TOOL.get(toolName);
  if (known !== undefined) return { verdict: 'refused', reason: known };
  return { verdict: 'refused', reason: 'unknown-tool' };
}

export function speculationRefusalMessage(toolName: string, reason: SpeculationRefusalReason): string {
  return (
    `Tool "${toolName}" is refused during a speculative run (${reason}). ` +
    'A speculative branch cannot cause effects that its accept/discard decision cannot see or undo. ' +
    'Whole-file writes are captured in the branch overlay; wait for the branch to be accepted or discarded.'
  );
}
