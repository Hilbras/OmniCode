import {
  admitElicitation,
  type ElicitationPolicy,
  type ElicitationRequest,
} from '#/mcpCore/resourceSurface';

import { admitReviewer, type ReviewerGuard, type ReviewerLane } from './reviewerLane';
import { schemaRequiresNoValues } from './reviewerScope';

/**
 * Server-initiated MCP elicitation, routed past the reviewer lane.
 *
 * An elicitation asks the *user* for values. A reviewer cannot supply them, so
 * any schema that needs input is human-required and the lane is never
 * consulted. The one reviewable shape is an elicitation whose schema provably
 * carries no fields: accepting it answers nothing, so the reviewer may
 * acknowledge it on the user's behalf.
 *
 * `admitElicitation` (operator opt-in plus server allowlist) still runs first
 * and is never weakened by the reviewer: a disabled or unlisted server is
 * refused before the lane exists in the flow.
 */
export type ElicitationDisposition = 'refused' | 'user' | 'auto-accepted';

export interface ElicitationResolution {
  readonly disposition: ElicitationDisposition;
  readonly reason: string;
}

export interface ElicitationReviewInput {
  readonly policy: ElicitationPolicy;
  readonly serverName: string;
  readonly request: ElicitationRequest;
  readonly lane: ReviewerLane | undefined;
  readonly guard?: ReviewerGuard;
  readonly timeoutMs?: number;
}

const ELICITATION_POLICY_ORIGIN = 'mcp-elicitation';

export function elicitationRequiresHumanData(request: ElicitationRequest): boolean {
  return !schemaRequiresNoValues(request.schema);
}

export function elicitationReviewRequest(
  serverName: string,
  request: ElicitationRequest,
): {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly fingerprint: string;
  readonly approvalRule: string;
  readonly askKind: 'elicitation';
  readonly display: {
    readonly kind: 'elicitation';
    readonly serverName: string;
    readonly message: string;
    readonly schema: unknown;
  };
} {
  return {
    toolCallId: `elicitation:${serverName}`,
    toolName: `mcp:${serverName}`,
    fingerprint: ELICITATION_POLICY_ORIGIN,
    approvalRule: `${ELICITATION_POLICY_ORIGIN}:${serverName}`,
    askKind: 'elicitation',
    display: {
      kind: 'elicitation',
      serverName,
      message: request.message,
      schema: request.schema,
    },
  };
}

export async function resolveElicitation(
  input: ElicitationReviewInput,
): Promise<ElicitationResolution> {
  const admission = admitElicitation(input.policy, input.serverName, input.request);
  if (!admission.admitted) return { disposition: 'refused', reason: admission.reason };
  if (elicitationRequiresHumanData(input.request)) {
    return { disposition: 'user', reason: 'elicitation requires human input' };
  }
  if (input.lane === undefined) {
    return { disposition: 'user', reason: 'no reviewer configured' };
  }
  const outcome = await admitReviewer({
    decision: 'ask',
    reason: { elicitation: true },
    policyName: ELICITATION_POLICY_ORIGIN,
    request: elicitationReviewRequest(input.serverName, input.request),
    lane: input.lane,
    timeoutMs: input.timeoutMs,
    guard: input.guard,
  });
  return outcome.kind === 'approve'
    ? {
        disposition: 'auto-accepted',
        reason: 'reviewer approved an elicitation that asks for no user input',
      }
    : { disposition: 'user', reason: outcome.why };
}