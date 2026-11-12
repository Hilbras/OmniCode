import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REVIEWER_TIMEOUT_MS,
  admitReviewer,
  requiresHumanDecision,
  type ReviewerAnswer,
  type ReviewerLane,
  type ReviewerRequest,
} from '#/agent/interaction/reviewer/reviewerLane';

const request: ReviewerRequest = {
  toolCallId: 'call_1',
  toolName: 'Bash',
  fingerprint: 'bash:npm test',
  approvalRule: 'Bash:npm test',
  display: { command: 'npm test' },
};

function lane(answer: ReviewerAnswer | Error | Promise<never>): ReviewerLane {
  return {
    async review() {
      if (answer instanceof Error) throw answer;
      if (answer instanceof Promise) return answer;
      return answer;
    },
  };
}

const base = { policyName: 'fallback-ask', request } as const;

describe('requiresHumanDecision', () => {
  it('reads only the literal true', () => {
    expect(requiresHumanDecision({ requires_human: true })).toBe(true);
    expect(requiresHumanDecision({ requires_human: 'true' })).toBe(false);
    expect(requiresHumanDecision(undefined)).toBe(false);
  });
});

describe('admitReviewer', () => {
  it('never reviews a policy decision', async () => {
    await expect(
      admitReviewer({ ...base, decision: 'deny', lane: lane({ kind: 'approve' }) }),
    ).resolves.toMatchObject({ kind: 'defer' });
    await expect(
      admitReviewer({ ...base, decision: 'approve', lane: lane({ kind: 'reject' }) }),
    ).resolves.toMatchObject({ kind: 'defer' });
  });

  it('never reviews a human-required ask', async () => {
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      reason: { exec_policy: 'rule', requires_human: true },
      lane: lane({ kind: 'approve' }),
    });
    expect(outcome).toEqual({ kind: 'defer', why: 'approval requires a human decision' });
  });

  it('approves when the reviewer approves', async () => {
    await expect(
      admitReviewer({ ...base, decision: 'ask', lane: lane({ kind: 'approve', note: 'safe' }) }),
    ).resolves.toEqual({ kind: 'approve', note: 'safe' });
  });

  it('defers when the reviewer rejects or is unclear', async () => {
    await expect(
      admitReviewer({ ...base, decision: 'ask', lane: lane({ kind: 'reject' }) }),
    ).resolves.toMatchObject({ kind: 'defer' });
    await expect(
      admitReviewer({ ...base, decision: 'ask', lane: lane({ kind: 'unclear' }) }),
    ).resolves.toMatchObject({ kind: 'defer' });
  });

  it('defers without a lane', async () => {
    await expect(
      admitReviewer({ ...base, decision: 'ask', lane: undefined }),
    ).resolves.toEqual({ kind: 'defer', why: 'no reviewer configured' });
  });

  it('fails closed on a reviewer exception', async () => {
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      lane: lane(new Error('boom')),
    });
    expect(outcome.kind).toBe('defer');
    expect(outcome.kind === 'defer' ? outcome.why : '').toContain('reviewer failed');
  });

  it('times out into a defer and aborts the reviewer', async () => {
    let seen: AbortSignal | undefined;
    const hanging: ReviewerLane = {
      review: (_request, signal) => {
        seen = signal;
        return new Promise<never>(() => {});
      },
    };
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      lane: hanging,
      timeoutMs: 10,
    });
    expect(outcome.kind).toBe('defer');
    expect(outcome.kind === 'defer' ? outcome.why : '').toContain('timed out after 10ms');
    expect(seen?.aborted).toBe(true);
  });

  it('treats a junk timeout as the default', async () => {
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      lane: lane({ kind: 'approve' }),
      timeoutMs: -5,
    });
    expect(outcome.kind).toBe('approve');
    expect(DEFAULT_REVIEWER_TIMEOUT_MS).toBe(20_000);
  });
});
