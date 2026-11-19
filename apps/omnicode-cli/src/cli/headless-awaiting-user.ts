/**
 * Headless (`omnicode -p`) awaiting-user policy.
 *
 * In an interactive session a final message that asks the user to decide
 * something is a normal hand-off. In headless mode there is nobody to answer:
 * the run would print the question, exit successfully, and leave the task
 * unfinished — the same "paused until I say continue" symptom, but invisible
 * to a CI job. The tool-level `AskUserQuestion` path is already denied by auto
 * mode; this closes the prose path.
 *
 * Deliberately conservative: only explicit requests for a user decision in
 * the closing part of the final message count. A rhetorical question inside a
 * completed answer does not. Opt out with OMNICODE_HEADLESS_AWAITING_USER=0.
 */

export const HEADLESS_AWAITING_USER_ENV_KEY = 'OMNICODE_HEADLESS_AWAITING_USER';

const USER_INPUT_REQUEST =
  /\b(?:what should i do|what do you (?:want|prefer)|which (?:one|approach|option|should i|do you want|would you like)|should i|do you want (?:me|us) to|would you like me to|can you (?:decide|choose|confirm|tell me)|could you (?:decide|choose|confirm)|please (?:decide|choose|confirm|let me know|tell me|advise)|let me know (?:how|what|which|if)|waiting (?:for|on) (?:you|your|the user)|i need (?:you|your|the user) (?:input|decision|confirmation|choice)|need (?:your|a|the user'?s) (?:decision|confirmation|input|choice)|how would you like|which would you prefer|tell me (?:how|what|which)|over to you)\b/i;

export const HEADLESS_AWAITING_USER_MESSAGE =
  'Headless run ended while asking the user for input. ' +
  'There is no interactive user to answer in print mode: provide the decision in the prompt, ' +
  'use an interactive session, or disable this check with OMNICODE_HEADLESS_AWAITING_USER=0.';

export class HeadlessAwaitingUserError extends Error {
  override readonly name = 'HeadlessAwaitingUserError';

  constructor() {
    super(HEADLESS_AWAITING_USER_MESSAGE);
  }
}

export function isHeadlessAwaitingUserEnabled(
  env: NodeJS.ProcessEnv | undefined = process.env,
): boolean {
  const raw = env?.[HEADLESS_AWAITING_USER_ENV_KEY];
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false');
}

export function isAwaitingUserText(text: string): boolean {
  const tail = text.trim().slice(-400);
  return tail.length > 0 && USER_INPUT_REQUEST.test(tail);
}

export function assertNotAwaitingUser(
  text: string,
  enabled: boolean = isHeadlessAwaitingUserEnabled(),
): void {
  if (enabled && isAwaitingUserText(text)) throw new HeadlessAwaitingUserError();
}
