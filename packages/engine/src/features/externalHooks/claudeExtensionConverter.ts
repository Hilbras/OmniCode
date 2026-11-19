/**
 * Claude-compatible extension converter (WS4.9 / Q8).
 *
 * Imports Claude Code's declarative hook configuration into the native
 * `externalHooks` seam. This is an import path, not a second runtime: every
 * converted entry is a native `HookDefConfig`, and anything the native seam
 * cannot represent is reported rather than silently dropped.
 */
import { HOOK_EVENT_TYPES, type HookEventType } from './internal/types';
import type { HookDefConfig } from './configSection';

const SUPPORTED_EVENTS = new Set<string>(HOOK_EVENT_TYPES);
const MAX_TIMEOUT_S = 600;

export interface ClaudeHookEntry {
  readonly type?: string;
  readonly command?: string;
  readonly timeout?: number;
}

export interface ClaudeHookGroup {
  readonly matcher?: string;
  readonly hooks?: readonly ClaudeHookEntry[];
}

export interface ClaudeExtensionConfig {
  readonly hooks?: Readonly<Record<string, readonly ClaudeHookGroup[]>>;
}

export interface ClaudeConversionDiagnostic {
  readonly event: string;
  readonly reason: 'unsupported-event' | 'unsupported-hook-type' | 'missing-command';
  readonly detail: string;
}

export interface ClaudeConversionResult {
  readonly hooks: readonly HookDefConfig[];
  readonly diagnostics: readonly ClaudeConversionDiagnostic[];
}

function asEvent(name: string): HookEventType | undefined {
  return SUPPORTED_EVENTS.has(name) ? (name as HookEventType) : undefined;
}

export function convertClaudeExtension(config: ClaudeExtensionConfig): ClaudeConversionResult {
  const hooks: HookDefConfig[] = [];
  const diagnostics: ClaudeConversionDiagnostic[] = [];

  for (const [eventName, groups] of Object.entries(config.hooks ?? {})) {
    const event = asEvent(eventName);
    if (event === undefined) {
      diagnostics.push({
        event: eventName, reason: 'unsupported-event',
        detail: `native hooks have no "${eventName}" event`,
      });
      continue;
    }
    for (const group of groups ?? []) {
      for (const hook of group.hooks ?? []) {
        if (hook.type !== undefined && hook.type !== 'command') {
          diagnostics.push({
            event: eventName, reason: 'unsupported-hook-type',
            detail: `hook type "${hook.type}" cannot be imported`,
          });
          continue;
        }
        if (typeof hook.command !== 'string' || hook.command.length === 0) {
          diagnostics.push({
            event: eventName, reason: 'missing-command',
            detail: 'command hook has no command',
          });
          continue;
        }
        const timeout =
          typeof hook.timeout === 'number' && Number.isFinite(hook.timeout)
            ? Math.min(Math.max(Math.trunc(hook.timeout), 1), MAX_TIMEOUT_S)
            : undefined;
        hooks.push({
          event,
          command: hook.command,
          ...(group.matcher === undefined ? {} : { matcher: group.matcher }),
          ...(timeout === undefined ? {} : { timeout }),
        });
      }
    }
  }

  return { hooks, diagnostics };
}
