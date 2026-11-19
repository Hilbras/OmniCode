/**
 * Two-tier deny taxonomy for the AUTO-mode classifier (WS4.1).
 *
 * A soft deny is the ordinary "not classified yet" ask: an explicit user
 * approval may remember the action as a trusted answer. A hard deny is
 * absolute — exfiltration-shaped actions and, critically, any action the user
 * has already rejected. The latter is the bypass-after-denial rule: the model
 * must not be able to re-ask a rejected action in a later turn until the user
 * relents, because repeated asking is itself a pressure tactic.
 */
export type DenyKind = 'soft' | 'hard';

export const HARD_DENY_CATEGORIES = new Set(['exfiltration', 'bypass-after-denial']);

export function classifyDeny(category: string): DenyKind {
  return HARD_DENY_CATEGORIES.has(category) ? 'hard' : 'soft';
}

export interface TrustedAnswerPermissionInput {
  readonly fingerprint: string;
  readonly deniedFingerprints: ReadonlySet<string>;
  readonly category?: string;
}

export function isTrustedAnswerAllowed(input: TrustedAnswerPermissionInput): boolean {
  if (input.deniedFingerprints.has(input.fingerprint)) return false;
  return input.category === undefined || classifyDeny(input.category) !== 'hard';
}
