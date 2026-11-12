/**
 * Shared read-only shell predicate.
 *
 * `tool/read-only-command.ts` parses and classifies; this module is the seam
 * everything else asks about a shell call, so the scheduler, the loop watch,
 * and the auto-mode classifier cannot drift into three different answers.
 *
 * Two rules keep it cheap and predictable:
 *
 * - The parse is expensive relative to a permission check, so results are
 *   memoized per process env of `command → verdict`, bounded in size.
 * - Anything that looks like a write or an escape is a miss. A predicate that
 *   answers "read-only" wrongly lets the scheduler overlap writers, so misses
 *   are the safe default.
 */

import type { IBashParserService } from '#/app/bashParser/bashParser';
import { isReadOnlyBashCommand } from '#/tool/read-only-command';

export const SHELL_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>(['Bash']);

/** Verdicts cached before the cache is dropped wholesale. */
export const READ_ONLY_SHELL_CACHE_LIMIT = 256;

export interface ReadOnlyShellInput {
  readonly name: string;
  readonly args: unknown;
}

export type ShellReadOnlyReason =
  | 'read-only-command'
  | 'not-a-shell-tool'
  | 'no-parser'
  | 'parse-miss'
  | 'classified-write';

export interface ShellReadOnlyVerdict {
  readonly readOnly: boolean;
  readonly reason: ShellReadOnlyReason;
}

const verdictCache = new Map<string, boolean>();

function commandText(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = (args as { readonly command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function cacheKey(command: string): string {
  // The classification depends on the command text only; quoting and trailing
  // whitespace do not change the parsed verbs.
  return command.trim();
}

/** Full verdict, for callers that want to log why a call was (not) read-only. */
export function classifyReadOnlyShell(
  input: ReadOnlyShellInput,
  parser: IBashParserService | undefined,
): ShellReadOnlyVerdict {
  if (!SHELL_READ_ONLY_TOOL_NAMES.has(input.name)) {
    return { readOnly: false, reason: 'not-a-shell-tool' };
  }
  const command = commandText(input.args);
  if (command === undefined) return { readOnly: false, reason: 'parse-miss' };
  if (parser === undefined) return { readOnly: false, reason: 'no-parser' };

  const key = cacheKey(command);
  const cached = verdictCache.get(key);
  if (cached !== undefined) {
    return cached
      ? { readOnly: true, reason: 'read-only-command' }
      : { readOnly: false, reason: 'classified-write' };
  }

  const readOnly = isReadOnlyBashCommand(input.args, parser);
  if (verdictCache.size >= READ_ONLY_SHELL_CACHE_LIMIT) verdictCache.clear();
  verdictCache.set(key, readOnly);
  return readOnly
    ? { readOnly: true, reason: 'read-only-command' }
    : { readOnly: false, reason: 'classified-write' };
}

/** True when a shell call provably only reads: safe to overlap with other reads. */
export function isReadOnlyShellCall(
  input: ReadOnlyShellInput,
  parser: IBashParserService | undefined,
): boolean {
  return classifyReadOnlyShell(input, parser).readOnly;
}

/** Drops memoized verdicts; for tests and config reloads. */
export function clearReadOnlyShellCache(): void {
  verdictCache.clear();
}
