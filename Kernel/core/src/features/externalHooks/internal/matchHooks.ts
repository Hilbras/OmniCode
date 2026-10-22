import { onUnexpectedError } from '#/_base/errors/unexpectedError';
import type { IHostProcessService } from '#/os/interface/hostProcess';

import type { ExternalHooksRunnerTriggerArgs } from '../app/externalHooksRunner';
import { runHook } from './runHook';
import type {
  HookApproveDecision,
  HookBlockDecision,
  HookDef,
  HookMatcherValue,
  HookResult,
} from './types';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 30;

export interface HookRunCallbacks {
  readonly onTriggered?: (event: string, target: string, count: number) => void;
  readonly onResolved?: (
    event: string,
    target: string,
    action: string,
    reason: string | undefined,
    durationMs: number,
  ) => void;
}

export function indexHooks(hooks: readonly HookDef[]): Map<string, HookDef[]> {
  const byEvent = new Map<string, HookDef[]>();
  for (const hook of hooks) {
    const entries = byEvent.get(hook.event) ?? [];
    entries.push(hook);
    byEvent.set(hook.event, entries);
  }
  return byEvent;
}

export async function runMatchedHooks(
  hostProcess: IHostProcessService,
  byEvent: ReadonlyMap<string, readonly HookDef[]>,
  event: string,
  args: ExternalHooksRunnerTriggerArgs,
  callbacks: HookRunCallbacks = {},
): Promise<HookResult[]> {
  const matcherValue = matcherValueText(args.matcherValue);
  const cwd = args.cwd ?? '';
  const matched: HookDef[] = [];
  const seen = new Set<string>();
  for (const hook of byEvent.get(event) ?? []) {
    if (!matches(hook.matcher ?? '', matcherValue)) continue;
    const key = (hook.cwd ?? '') + '\0' + hook.command;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(hook);
  }
  if (matched.length === 0) return [];

  try {
    callbacks.onTriggered?.(event, matcherValue, matched.length);
  } catch {}

  const inputData = toHookInputData({
    hookEventName: event,
    sessionId: args.sessionId ?? '',
    cwd,
    ...args.inputData,
  });

  const startedAt = Date.now();
  const results = await Promise.all(
    matched.map((hook) =>
      runHook(hostProcess, hook.command, inputData, {
        timeout: hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
        cwd: hook.cwd ?? (cwd === '' ? undefined : cwd),
        env: hook.env,
        signal: args.signal,
      }),
    ),
  );

  const decision = resolveDecision(event, results);
  try {
    callbacks.onResolved?.(
      event,
      matcherValue,
      decision === undefined ? 'allow' : decision.kind,
      decision?.reason,
      Date.now() - startedAt,
    );
  } catch {}

  return results;
}

export function resolveDecision(
  event: string,
  results: readonly HookResult[],
): HookApproveDecision | HookBlockDecision | undefined {
  const block = results.find((result) => result.action === 'block');
  if (block !== undefined) {
    const reason = block.reason?.trim();
    return {
      kind: 'block',
      reason: reason === undefined || reason.length === 0 ? `Blocked by ${event} hook` : reason,
    };
  }
  const approve = results.find((result) => result.action === 'approve');
  if (approve !== undefined) {
    const reason = approve.reason?.trim();
    return {
      kind: 'approve',
      reason: reason === undefined || reason.length === 0 ? undefined : reason,
    };
  }
  return undefined;
}

function matches(pattern: string, value: string): boolean {
  if (pattern.length === 0) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    onUnexpectedError(
      new Error(`hook matcher "${pattern}" is not a valid regular expression; the hook never runs`),
    );
    return false;
  }
}

function matcherValueText(value: HookMatcherValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

function toHookInputData(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    result[camelToSnake(key)] = value;
  }
  return result;
}

function camelToSnake(value: string): string {
  return value.replaceAll(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
