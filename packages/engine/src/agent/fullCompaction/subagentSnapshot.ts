/**
 * Post-compaction subagent snapshot.
 *
 * Compaction drops the conversation, and with it the memory of which subagents
 * were spawned and what they were asked to do — so the model may respawn a
 * duplicate or lose track of a finished one. This module renders a compact
 * snapshot of the subagent entries the caller hands it; like the file
 * restoration it discovers nothing on its own and never throws.
 *
 * Caps keep one long session's subagent history from recreating the bulk
 * compaction removed, with a visible omission note when a cap bites.
 * Descriptions are collapsed to a single line so they cannot forge headings.
 */

export const POST_COMPACTION_SUBAGENTS_HEADING = '## Subagents Before Compaction';

export interface SubagentSnapshotEntry {
  readonly taskId: string;
  readonly agentId?: string;
  readonly description: string;
  readonly subagentType?: string;
  readonly status: string;
}

export interface SubagentSnapshotConfig {
  /** Entries listed per compaction. Default 8. */
  readonly maxEntries?: number;
  /** Characters kept from each description. Default 120. */
  readonly maxDescriptionChars?: number;
  /** Characters kept for the whole section. Default 4000. */
  readonly maxTotalChars?: number;
}

export interface SubagentSnapshotInput {
  readonly subagents: readonly SubagentSnapshotEntry[];
  readonly config?: SubagentSnapshotConfig;
}

const DEFAULTS = {
  maxEntries: 8,
  maxDescriptionChars: 120,
  maxTotalChars: 4_000,
} as const;

const RESUME_NOTE =
  'Subagents that are no longer running keep their own context; resume one with Agent(resume="<agent_id>", ...) when its result is needed again.';

export function renderSubagentSnapshot(input: SubagentSnapshotInput): string | undefined {
  const config = {
    maxEntries: positiveOrDefault(input.config?.maxEntries, DEFAULTS.maxEntries),
    maxDescriptionChars: positiveOrDefault(
      input.config?.maxDescriptionChars,
      DEFAULTS.maxDescriptionChars,
    ),
    maxTotalChars: positiveOrDefault(input.config?.maxTotalChars, DEFAULTS.maxTotalChars),
  };
  const parts: string[] = [POST_COMPACTION_SUBAGENTS_HEADING];
  let used = parts[0]!.length;
  let written = 0;
  let resumeNote = false;
  for (const subagent of input.subagents) {
    if (written > 0 && used + entryBudget(subagent, config) > config.maxTotalChars) break;
    if (written >= config.maxEntries) break;
    const line = renderEntry(subagent, config.maxDescriptionChars);
    parts.push(line);
    used += line.length;
    written += 1;
    if (subagent.agentId !== undefined && subagent.status !== 'running') resumeNote = true;
  }
  const notListed = input.subagents.length - written;
  if (notListed > 0) parts.push(`(${String(notListed)} more subagent(s) not listed)`);
  if (resumeNote) parts.push(RESUME_NOTE);
  return written === 0 ? undefined : parts.join('\n');
}

function renderEntry(subagent: SubagentSnapshotEntry, maxDescriptionChars: number): string {
  const description = oneLine(subagent.description, maxDescriptionChars);
  const type =
    subagent.subagentType === undefined || subagent.subagentType.length === 0
      ? ''
      : ` (${subagent.subagentType})`;
  return `- ${subagent.taskId} "${description}"${type} — ${subagent.status}`;
}

function entryBudget(subagent: SubagentSnapshotEntry, config: ResolvedConfig): number {
  return renderEntry(subagent, config.maxDescriptionChars).length + 1;
}

interface ResolvedConfig {
  readonly maxEntries: number;
  readonly maxDescriptionChars: number;
  readonly maxTotalChars: number;
}

/** Collapses newlines and clips, so the value cannot start a markdown line. */
function oneLine(value: string, maxChars: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars)}…`;
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}
