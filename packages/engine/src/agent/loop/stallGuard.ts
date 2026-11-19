/**
 * Intent-ack stall guard: detect a final assistant text that announces more
 * work ("I did X; next I'll do Y") even though the step produced no tool call.
 * In the base agent loop such a response ends the turn, which surfaces to the
 * user as "the agent paused and waits for me to say continue".
 *
 * The detector is intentionally conservative: it fires only when an explicit
 * next-action marker is present and the response is short (progress notes,
 * not a final report). Bounded to two nudges per turn by the loop, with an
 * env opt-out. A miss is a premature stop; a false positive costs one extra
 * model step, so the cap keeps the failure mode cheap.
 */

export const STALL_GUARD_ENV_KEY = 'OMNICODE_STALL_GUARD';
export const DEFAULT_MAX_STALL_NUDGES = 2;

/** A short progress note ends with an open form. */
const OPEN_ENDING = /(?:\.\.\.|…|:)\s*$/;

/** Partial-status markers anywhere in the note. */
const PARTIAL_STATUS = /\b(?:so far|so next|up next|to do|remaining|still need to)\b/i;

/** Explicit next-action / continuation markers. */
const NEXT_ACTION =
  /\b(next|now|then|after that|afterwards|I'?ll|I will|let me|going to|about to|still need to|need to|continue|proceeding|working on|on to)\b/i;

/** Strong completion markers — a response with one of these is a final answer. */
const FINALIZED =
  /\b(all done|task complete|fully complete|tests? (?:all )?pass(?:ed)?|implementation (?:is )?(?:complete|finished)|deliverable (?:is )?ready)\b/i;

export interface StallGuardInput {
  readonly text: string;
  readonly nudgesUsed: number;
  readonly enabled: boolean;
  readonly maxNudges?: number;
  /** Files were written this turn and no read/verification tool ran afterwards. */
  readonly unverifiedWrites?: boolean;
}

export function isStallGuardEnabled(env: NodeJS.ProcessEnv | undefined = process.env): boolean {
  const raw = env?.[STALL_GUARD_ENV_KEY];
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false');
}

export function isIntentAckText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 1_200) return false;
  if (FINALIZED.test(trimmed)) return false;
  if (!NEXT_ACTION.test(trimmed) && !OPEN_ENDING.test(trimmed) && !PARTIAL_STATUS.test(trimmed)) return false;
  return true;
}

export function shouldNudgeStalledTurn(input: StallGuardInput): boolean {
  if (!input.enabled) return false;
  if (input.nudgesUsed >= (input.maxNudges ?? DEFAULT_MAX_STALL_NUDGES)) return false;
  if (input.unverifiedWrites === true) return true;
  return isIntentAckText(input.text);
}

export const VERIFICATION_NUDGE_TEXT =
  'You changed files this turn but have not verified the result. Run the relevant check or re-read the changed file before you finish.';

export const STALL_NUDGE_TEXT =
  'Continue the task now: take the next concrete step with a tool. Do not restate status or ask what to do next — the work is still in progress.';
