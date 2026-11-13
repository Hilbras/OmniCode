import { isSensitiveFile } from '#/tool/path-access';

/**
 * Which approval asks an automated reviewer may answer.
 *
 * This is the reviewer's own trust boundary, and it is a deny-by-default one:
 * anything not positively recognised here defers to the user. The reviewed
 * surface is deliberately narrow — a local file read, or a local file write
 * that the path policy did not already protect — because the reviewer exists to
 * spare the user routine local prompts, never to widen what the agent may do.
 *
 * Two independent walls guard the same boundary:
 *
 * - Only the `fallback-ask` policy origin is reviewable. A boundary ask
 *   (sensitive file, git control file, dangerous shell, exec-policy
 *   `prompt-user`, auto-mode classifier, operator-configured ask) therefore
 *   never reaches the lane even if its display looks harmless.
 * - The display must name a local read or write. Shell, network, delegation,
 *   interactive, and unknown surfaces are out of scope.
 */

export type ReviewerScopeBand = 'local-read' | 'local-write' | 'elicitation-ack';

/** What is being approved; defaults to a tool approval. */
export type ReviewerAskKind = 'tool' | 'elicitation';

export interface ReviewerScopeVerdict {
  readonly reviewable: boolean;
  /** Only present when `reviewable` is true. */
  readonly band?: ReviewerScopeBand;
  readonly why?: string;
}

const READ_FILE_OPERATIONS = new Set(['read', 'glob', 'grep']);
const WRITE_FILE_OPERATIONS = new Set(['write', 'edit']);

export const REVIEWABLE_POLICY_ORIGINS: ReadonlySet<string> = new Set(['fallback-ask']);

const ELICITATION_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when the elicitation schema cannot be answered without inventing input.
 *
 * Empty properties plus no required fields is the only shape an automated
 * reviewer may answer: everything else asks the user for data, and a reviewer
 * must never fabricate user input. Unknown schema keywords are treated as
 * data-carrying (fail closed) rather than guessed at.
 */
export function schemaRequiresNoValues(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  for (const key of Object.keys(schema)) {
    if (!ELICITATION_SCHEMA_KEYS.has(key)) return false;
  }
  const type = schema['type'];
  if (type !== undefined && type !== 'object') return false;
  if (schema['additionalProperties'] === true) return false;
  const properties = schema['properties'];
  if (properties !== undefined && (!isRecord(properties) || Object.keys(properties).length > 0)) {
    return false;
  }
  const required = schema['required'];
  if (required !== undefined && (!Array.isArray(required) || required.length > 0)) return false;
  return true;
}

/** True when the elicitation must be answered by the user, not the lane. */
function displayRequiresHumanElicitation(display: unknown): boolean {
  if (!isRecord(display) || display['kind'] !== 'elicitation') return true;
  return !schemaRequiresNoValues(display['schema']);
}

export function classifyReviewAsk(
  askKind: ReviewerAskKind,
  display: unknown,
): ReviewerScopeVerdict {
  if (askKind === 'elicitation') {
    if (!isRecord(display) || display['kind'] !== 'elicitation') {
      return { reviewable: false, why: 'elicitation ask without an elicitation payload' };
    }
    if (typeof display['serverName'] !== 'string' || display['serverName'].length === 0) {
      return { reviewable: false, why: 'elicitation ask without a server name' };
    }
    if (displayRequiresHumanElicitation(display)) {
      return { reviewable: false, why: 'elicitation requires human input' };
    }
    return { reviewable: true, band: 'elicitation-ack' };
  }
  if (!isRecord(display)) return { reviewable: false, why: 'unknown approval surface' };
  const surface = display['kind'];
  if (surface === 'file_io') {
    const operation = display['operation'];
    const path = display['path'];
    if (typeof operation !== 'string') {
      return { reviewable: false, why: 'file approval without an operation' };
    }
    if (typeof path !== 'string' || path.length === 0) {
      return { reviewable: false, why: 'file approval without a path' };
    }
    const read = READ_FILE_OPERATIONS.has(operation);
    if (!read && !WRITE_FILE_OPERATIONS.has(operation)) {
      return { reviewable: false, why: `file operation ${operation} is outside reviewer scope` };
    }
    if (isSensitiveFile(path)) {
      return { reviewable: false, why: `path ${path} is a protected file` };
    }
    if (read) return { reviewable: true, band: 'local-read' };
    return { reviewable: true, band: 'local-write' };
  }
  if (surface === 'diff') {
    const path = display['path'];
    if (typeof path !== 'string' || path.length === 0) {
      return { reviewable: false, why: 'diff approval without a path' };
    }
    if (isSensitiveFile(path)) {
      return { reviewable: false, why: `path ${path} is a protected file` };
    }
    return { reviewable: true, band: 'local-write' };
  }
  if (surface === 'search') {
    // The only producer of this display is the outbound WebSearch tool; local
    // session search renders `generic`. A search display is therefore network.
    return { reviewable: false, why: 'search surface is network-bound' };
  }
  const surfaceName = typeof surface === 'string' ? surface : 'unknown';
  return {
    reviewable: false,
    why: `approval surface ${surfaceName} is outside reviewer scope`,
  };
}