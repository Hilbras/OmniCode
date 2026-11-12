import { canonicalizeCommand } from './commandCanonicalization';

/**
 * AUTO-mode denial tracking state machine.
 *
 * Protects users from infinite loops when an AUTO-mode classifier persistently
 * blocks or is unavailable. The exact blocked action may be retried once through
 * DEFAULT-mode confirmation. Reaching a consecutive threshold or the total denial
 * cap also falls back to that confirmation. The session stays in AUTO; only the
 * single offending call is downgraded.
 */

export type DenialFallbackReason =
  | 'classifier_blocked_retry'
  | 'consecutive_block'
  | 'consecutive_unavailable'
  | 'total_denial';

export interface AutoModeDenialState {
  readonly consecutiveBlock: number;
  readonly consecutiveUnavailable: number;
  readonly totalBlock: number;
  readonly totalUnavailable: number;
  readonly pendingManualRetryFingerprint?: string;
}

export const AUTO_MODE_DENIAL_LIMITS = {
  maxConsecutiveBlock: 3,
  maxConsecutiveUnavailable: 2,
  maxTotalDenials: 20,
} as const;

function hasReachedTotalCap(state: AutoModeDenialState): boolean {
  return (
    state.totalBlock + state.totalUnavailable >=
    AUTO_MODE_DENIAL_LIMITS.maxTotalDenials
  );
}

export function createDenialState(): AutoModeDenialState {
  return {
    consecutiveBlock: 0,
    consecutiveUnavailable: 0,
    totalBlock: 0,
    totalUnavailable: 0,
  };
}

export function formatDenialStateLog(state: AutoModeDenialState): string {
  return (
    `consecutiveBlock=${state.consecutiveBlock}, ` +
    `consecutiveUnavailable=${state.consecutiveUnavailable}, ` +
    `totalBlock=${state.totalBlock}, ` +
    `totalUnavailable=${state.totalUnavailable}`
  );
}

export function isDenialFallbackReason(
  reason: string,
): reason is DenialFallbackReason {
  return (
    reason === 'consecutive_block' ||
    reason === 'classifier_blocked_retry' ||
    reason === 'consecutive_unavailable' ||
    reason === 'total_denial'
  );
}

export function recordAllow(
  state: AutoModeDenialState,
  actionFingerprint?: string,
): AutoModeDenialState {
  const clearsPendingRetry =
    actionFingerprint !== undefined &&
    state.pendingManualRetryFingerprint === actionFingerprint;
  if (
    state.consecutiveBlock === 0 &&
    state.consecutiveUnavailable === 0 &&
    !clearsPendingRetry
  ) {
    return state;
  }
  if (clearsPendingRetry) {
    return {
      consecutiveBlock: 0,
      consecutiveUnavailable: 0,
      totalBlock: state.totalBlock,
      totalUnavailable: state.totalUnavailable,
    };
  }
  return {
    ...state,
    consecutiveBlock: 0,
    consecutiveUnavailable: 0,
  };
}

export function recordBlock(
  state: AutoModeDenialState,
  actionFingerprint?: string,
): AutoModeDenialState {
  return {
    ...state,
    consecutiveBlock: state.consecutiveBlock + 1,
    consecutiveUnavailable: 0,
    totalBlock: state.totalBlock + 1,
    totalUnavailable: state.totalUnavailable,
    ...(actionFingerprint === undefined
      ? {}
      : { pendingManualRetryFingerprint: actionFingerprint }),
  };
}

export function recordUnavailable(
  state: AutoModeDenialState,
): AutoModeDenialState {
  return {
    ...state,
    consecutiveBlock: 0,
    consecutiveUnavailable: state.consecutiveUnavailable + 1,
    totalBlock: state.totalBlock,
    totalUnavailable: state.totalUnavailable + 1,
  };
}

export function shouldFallback(
  state: AutoModeDenialState,
  actionFingerprint?: string,
):
  | { readonly fallback: true; readonly reason: DenialFallbackReason }
  | { readonly fallback: false } {
  if (hasReachedTotalCap(state)) {
    return { fallback: true, reason: 'total_denial' };
  }
  if (state.consecutiveBlock >= AUTO_MODE_DENIAL_LIMITS.maxConsecutiveBlock) {
    return { fallback: true, reason: 'consecutive_block' };
  }
  if (
    state.consecutiveUnavailable >=
    AUTO_MODE_DENIAL_LIMITS.maxConsecutiveUnavailable
  ) {
    return { fallback: true, reason: 'consecutive_unavailable' };
  }
  if (
    actionFingerprint !== undefined &&
    state.pendingManualRetryFingerprint === actionFingerprint
  ) {
    return { fallback: true, reason: 'classifier_blocked_retry' };
  }
  return { fallback: false };
}

export function consumePendingManualRetry(
  state: AutoModeDenialState,
): AutoModeDenialState {
  if (state.pendingManualRetryFingerprint === undefined) return state;
  const next = { ...state };
  delete next.pendingManualRetryFingerprint;
  return next;
}

export function recordFallbackApprove(
  state: AutoModeDenialState,
): AutoModeDenialState {
  if (hasReachedTotalCap(state)) {
    return {
      ...state,
      consecutiveBlock: 0,
      consecutiveUnavailable: 0,
      totalBlock: 0,
      totalUnavailable: 0,
    };
  }
  if (state.consecutiveBlock === 0 && state.consecutiveUnavailable === 0) {
    return state;
  }
  return { ...state, consecutiveBlock: 0, consecutiveUnavailable: 0 };
}

export function resetDenialState(): AutoModeDenialState {
  return createDenialState();
}

export function actionFingerprint(toolName: string, args: unknown): string {
  if (toolName === 'Bash' && typeof args === 'object' && args !== null && typeof (args as { command?: unknown }).command === 'string') {
    return `${toolName}:${canonicalizeCommand((args as { command: string }).command).canonical}`;
  }
  try {
    return `${toolName}:${JSON.stringify(args ?? {})}`;
  } catch {
    return `${toolName}:<unserializable>`;
  }
}