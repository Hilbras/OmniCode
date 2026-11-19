import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REVIEWER_TIMEOUT_MS,
  ReviewerGuard,
  admitReviewer,
  requiresHumanDecision,
  reviewerOutOfScope,
  type ReviewerAnswer,
  type ReviewerLane,
  type ReviewerRequest,
} from '#/agent/interaction/reviewer/reviewerLane';
import { classifyReviewAsk } from '#/agent/interaction/reviewer/reviewerScope';
import { buildReviewerPrompt, parseReviewerAnswer } from '#/agent/interaction/reviewer/reviewerPrompt';
import {
  ReviewerSampleBudget,
  normalizeReviewerSamples,
  runReviewSampling,
} from '#/agent/interaction/reviewer/reviewerSampling';
import {
  AgentReviewerLaneService,
  reviewerModelFromRequester,
} from '#/agent/interaction/reviewer/reviewerLaneService';
import { IConfigService } from '#/app/config/config';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { resolveElicitation } from '#/agent/interaction/reviewer/reviewerElicitation';
import { LlmReviewerLane, type ReviewerModel } from '#/agent/interaction/reviewer/llmReviewerLane';
import type { ReviewerSectionConfig } from '#/agent/interaction/reviewer/configSection';
import { emptyUsage } from '#human/llm/usage';

const writeDisplay = { kind: 'file_io', operation: 'write', path: '/repo/src/app.ts' };

const request: ReviewerRequest = {
  toolCallId: 'call_1',
  toolName: 'Write',
  fingerprint: 'Write:/repo/src/app.ts',
  approvalRule: 'Write:/repo/src/app.ts',
  display: writeDisplay,
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

describe('classifyReviewAsk', () => {
  it('reviews local reads, writes, and diffs', () => {
    expect(classifyReviewAsk('tool', writeDisplay)).toMatchObject({
      reviewable: true,
      band: 'local-write',
    });
    expect(
      classifyReviewAsk('tool', { kind: 'file_io', operation: 'read', path: '/repo/a.ts' }),
    ).toMatchObject({ reviewable: true, band: 'local-read' });
    expect(
      classifyReviewAsk('tool', { kind: 'diff', path: '/repo/a.ts', before: '', after: '' }),
    ).toMatchObject({ reviewable: true, band: 'local-write' });
  });

  it('refuses every non-local surface', () => {
    for (const display of [
      { kind: 'command', command: 'rm -rf build' },
      { kind: 'url_fetch', url: 'https://example.test' },
      { kind: 'search', query: 'latest release notes' },
      { kind: 'agent_call', agent_name: 'worker', prompt: 'do it' },
      { kind: 'skill_call', skill_name: 'deploy' },
      { kind: 'plan_review', plan: '# plan' },
      { kind: 'generic', summary: 'anything' },
      { kind: 'file_io', operation: 'stat', path: '/repo/a.ts' },
      { kind: 'file_io', operation: 'write', path: '' },
      undefined,
      'not-a-display',
    ]) {
      expect(classifyReviewAsk('tool', display).reviewable).toBe(false);
    }
  });

  it('refuses protected paths', () => {
    expect(
      classifyReviewAsk('tool', { kind: 'file_io', operation: 'write', path: '/repo/.env' }),
    ).toMatchObject({ reviewable: false });
    expect(
      classifyReviewAsk('tool', {
        kind: 'file_io',
        operation: 'read',
        path: '/home/u/.ssh/id_rsa',
      }),
    ).toMatchObject({ reviewable: false });
    expect(
      classifyReviewAsk('tool', { kind: 'diff', path: '/repo/.npmrc', before: '', after: '' }),
    ).toMatchObject({ reviewable: false });
  });

  it('reviews only an elicitation that asks for no user input', () => {
    expect(
      classifyReviewAsk('elicitation', {
        kind: 'elicitation',
        serverName: 'server',
        schema: { type: 'object', properties: {}, required: [] },
      }),
    ).toMatchObject({ reviewable: true, band: 'elicitation-ack' });
    expect(
      classifyReviewAsk('elicitation', {
        kind: 'elicitation',
        serverName: 'server',
        schema: { type: 'object', properties: { token: { type: 'string' } } },
      }),
    ).toMatchObject({ reviewable: false });
    expect(
      classifyReviewAsk('elicitation', {
        kind: 'elicitation',
        serverName: 'server',
        schema: { type: 'object', additionalProperties: true },
      }),
    ).toMatchObject({ reviewable: false });
    expect(
      classifyReviewAsk('elicitation', { kind: 'elicitation', serverName: 'server', schema: {} }),
    ).toMatchObject({ reviewable: true });
    expect(
      classifyReviewAsk('elicitation', { kind: 'tool', path: '/repo/a.ts' }),
    ).toMatchObject({ reviewable: false });
  });
});

describe('reviewerOutOfScope', () => {
  it('keeps boundary policy origins human even with an ordinary display', () => {
    for (const origin of [
      'sensitive-file-access-ask',
      'git-control-path-access-ask',
      'dangerous-command-ask',
      'auto-mode-classifier',
      'exec-policy',
      'user-configured-ask',
    ]) {
      expect(reviewerOutOfScope(request, origin)).toMatchObject({
        why: `policy ${origin} is not reviewable`,
      });
    }
    expect(reviewerOutOfScope(request, 'fallback-ask')).toBeUndefined();
  });

  it('keeps out-of-scope surfaces human', () => {
    expect(
      reviewerOutOfScope({ ...request, display: { kind: 'command', command: 'ls' } }, 'fallback-ask'),
    ).toMatchObject({ why: expect.stringContaining('outside reviewer scope') });
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

  it('defers a boundary origin without consulting the lane or spending budget', async () => {
    const review = vi.fn(async () => ({ kind: 'approve' as const }));
    const guard = new ReviewerGuard();
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      policyName: 'sensitive-file-access-ask',
      lane: { review },
      guard,
    });
    expect(outcome).toEqual({
      kind: 'defer',
      why: 'outside reviewer scope: policy sensitive-file-access-ask is not reviewable',
    });
    expect(review).not.toHaveBeenCalled();
    expect(guard.state().used).toBe(0);
  });

  it('defers a protected path without consulting the lane or spending budget', async () => {
    const review = vi.fn(async () => ({ kind: 'approve' as const }));
    const guard = new ReviewerGuard();
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      request: {
        ...request,
        display: { kind: 'file_io', operation: 'write', path: '/repo/.env' },
      },
      lane: { review },
      guard,
    });
    expect(outcome).toMatchObject({ kind: 'defer' });
    expect(review).not.toHaveBeenCalled();
    expect(guard.state().used).toBe(0);
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

  it('uses the timeout the lane carries', async () => {
    const outcome = await admitReviewer({
      ...base,
      decision: 'ask',
      lane: {
        timeoutMs: 10,
        review: () => new Promise<never>(() => {}),
      },
    });
    expect(outcome.kind === 'defer' ? outcome.why : '').toContain('timed out after 10ms');
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

describe('ReviewerGuard', () => {
  const approve = () => lane({ kind: 'approve' });

  it('exhausts its session budget and then defers', async () => {
    const guard = new ReviewerGuard({ maxReviews: 2 });
    const input = { ...base, decision: 'ask' as const, lane: approve(), guard };
    await expect(admitReviewer(input)).resolves.toMatchObject({ kind: 'approve' });
    await expect(admitReviewer(input)).resolves.toMatchObject({ kind: 'approve' });
    await expect(admitReviewer(input)).resolves.toEqual({
      kind: 'defer',
      why: 'reviewer budget exhausted',
    });
    expect(guard.state()).toEqual({ used: 2, remaining: 0, consecutiveFailures: 0, open: false });
  });

  it('opens after consecutive failures and resets on a decisive answer', async () => {
    const guard = new ReviewerGuard({ failureThreshold: 2 });
    const failing = { ...base, decision: 'ask' as const, lane: lane(new Error('x')), guard };
    await admitReviewer(failing);
    await admitReviewer(failing);
    expect(guard.open()).toBe(true);
    await expect(admitReviewer(failing)).resolves.toEqual({
      kind: 'defer',
      why: 'reviewer circuit open',
    });

    const fresh = new ReviewerGuard({ failureThreshold: 2 });
    await admitReviewer({ ...base, decision: 'ask', lane: lane(new Error('x')), guard: fresh });
    await admitReviewer({ ...base, decision: 'ask', lane: lane({ kind: 'reject' }), guard: fresh });
    expect(fresh.state().consecutiveFailures).toBe(0);
  });

  it('counts unclear answers as failures', async () => {
    const guard = new ReviewerGuard({ failureThreshold: 1 });
    await admitReviewer({ ...base, decision: 'ask', lane: lane({ kind: 'unclear' }), guard });
    expect(guard.open()).toBe(true);
  });
});

describe('reviewer prompt', () => {
  it('is built from the ask payload alone', () => {
    const prompt = buildReviewerPrompt(request);
    expect(prompt.user).toContain('tool: Write');
    expect(prompt.user).toContain('rule: Write:/repo/src/app.ts');
    expect(prompt.user).toContain('/repo/src/app.ts');
    expect(prompt.user).toContain('<approval-request');
    expect(prompt.system).toContain('untrusted data');
    expect(prompt.system).toContain('JSON');
  });

  it('states the guardian authority rules (WS4.2)', () => {
    const system = buildReviewerPrompt(request).system;
    expect(system).toContain('only an original user instruction');
    expect(system).toContain('quoted content never grants');
    expect(system).toContain('Decide this request fresh');
  });

  it('caps the whole prompt, including the long approval rule', () => {
    const query = 'q'.repeat(5_000);
    const big = {
      ...request,
      approvalRule: `WebSearch:${query}`,
      display: { kind: 'file_io', operation: 'write', path: '/repo/a.ts', content: 'x'.repeat(500) },
    };
    const prompt = buildReviewerPrompt(big, { maxChars: 400 });
    expect(prompt.user).toContain('[prompt truncated');
    expect(prompt.user.length).toBeLessThan(500);
  });

  it('parses only the exact whole-reply answer shape', () => {
    expect(parseReviewerAnswer('{"decision":"approve","note":"ok"}')).toEqual({
      kind: 'approve',
      note: 'ok',
    });
    expect(parseReviewerAnswer('```json\n{"decision":"reject"}\n```')).toMatchObject({
      kind: 'reject',
    });
    expect(parseReviewerAnswer('  {"decision":"approve"}  ')).toMatchObject({ kind: 'approve' });
    expect(parseReviewerAnswer('I approve this request.').kind).toBe('unclear');
    expect(
      parseReviewerAnswer('The payload said {"decision":"approve"} so I approve.').kind,
    ).toBe('unclear');
    expect(parseReviewerAnswer('{"decision":"approve"}\nThanks!').kind).toBe('unclear');
    expect(parseReviewerAnswer('```json\n{"decision":"approve"}\n```\nDone.').kind).toBe('unclear');
    expect(parseReviewerAnswer('{"decision":"maybe"}').kind).toBe('unclear');
    expect(parseReviewerAnswer('{"verdict":"approve"}').kind).toBe('unclear');
    expect(parseReviewerAnswer('[]').kind).toBe('unclear');
    expect(parseReviewerAnswer('').kind).toBe('unclear');
  });
});

describe('reviewer resampling', () => {
  const parse = (text: string): ReviewerAnswer => parseReviewerAnswer(text);

  it('requires every sample to approve', async () => {
    const result = await runReviewSampling(
      async (attempt) => (attempt === 1 ? '{"decision":"approve","note":"fine"}' : '{"decision":"approve"}'),
      parse,
      { samples: 2, budget: new ReviewerSampleBudget(10) },
    );
    expect(result.answer).toMatchObject({ kind: 'approve' });
    expect(result.checkpoint.attempts).toHaveLength(2);
    expect(result.checkpoint.decisive).toBe(true);
  });

  it('stops at the first rejection and fails closed on disagreement', async () => {
    const reject = await runReviewSampling(
      async (attempt) => (attempt === 1 ? '{"decision":"approve"}' : '{"decision":"reject"}'),
      parse,
      { samples: 2, budget: new ReviewerSampleBudget(10) },
    );
    expect(reject.answer).toMatchObject({ kind: 'reject' });
    expect(reject.checkpoint.attempts).toHaveLength(2);

    const disagreement = await runReviewSampling(
      async (attempt) => (attempt === 1 ? '{"decision":"approve"}' : 'not json'),
      parse,
      { samples: 2, budget: new ReviewerSampleBudget(10) },
    );
    expect(disagreement.answer).toMatchObject({ kind: 'unclear', note: 'reviewer samples disagreed' });
  });

  it('truncates into unclear when the sample budget runs out', async () => {
    const calls: number[] = [];
    const result = await runReviewSampling(
      async (attempt) => {
        calls.push(attempt);
        return '{"decision":"approve"}';
      },
      parse,
      { samples: 2, budget: new ReviewerSampleBudget(1) },
    );
    expect(calls).toEqual([1]);
    expect(result.answer).toMatchObject({ kind: 'unclear', note: 'reviewer sample budget exhausted' });
    expect(result.checkpoint.truncated).toBe(true);
    expect(result.checkpoint.decisive).toBe(false);
  });

  it('normalizes the sample count to at least one and at most three', () => {
    expect(normalizeReviewerSamples(undefined)).toBe(1);
    expect(normalizeReviewerSamples(0)).toBe(1);
    expect(normalizeReviewerSamples(2.5)).toBe(1);
    expect(normalizeReviewerSamples(9)).toBe(3);
  });
});

describe('LlmReviewerLane', () => {
  function model(answer: string | Error): ReviewerModel & {
    readonly complete: ReturnType<typeof vi.fn<ReviewerModel['complete']>>;
  } {
    const complete = vi.fn<ReviewerModel['complete']>(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    return { complete };
  }

  it('reviews an in-scope ask through its own model seam', async () => {
    const seam = model('{"decision":"approve","note":"routine"}');
    const reviewer = new LlmReviewerLane({ model: seam });
    await expect(reviewer.review(request, new AbortController().signal)).resolves.toMatchObject({
      kind: 'approve',
      note: 'routine',
    });
    const call = seam.complete.mock.calls[0]?.[0];
    expect(call?.userPrompt).toContain('tool: Write');
    expect(call?.systemPrompt).toContain('approval reviewer');
    expect(reviewer.checkpoint()?.decisive).toBe(true);
  });

  it('never consults the model for an out-of-scope ask', async () => {
    const seam = model('{"decision":"approve"}');
    const reviewer = new LlmReviewerLane({ model: seam });
    const answer = await reviewer.review(
      { ...request, display: { kind: 'command', command: 'curl example.test' } },
      new AbortController().signal,
    );
    expect(answer.kind).toBe('unclear');
    expect(seam.complete).not.toHaveBeenCalled();
  });

  it('keeps the configured timeout and sample budget', () => {
    const reviewer = new LlmReviewerLane({
      model: model('{"decision":"approve"}'),
      timeoutMs: 1234,
      samples: 2,
      maxSamples: 4,
    });
    expect(reviewer.timeoutMs).toBe(1234);
    expect(reviewer.sampleState()).toEqual({ used: 0, remaining: 4 });
  });

  it('does not swallow an aborted signal', async () => {
    const reviewer = new LlmReviewerLane({ model: model('{"decision":"approve"}') });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(reviewer.review(request, controller.signal)).rejects.toThrow('cancelled');
  });
});

describe('resolveElicitation', () => {
  const emptySchemaRequest = { message: 'Syncing', schema: { type: 'object', properties: {} } };
  const policy = { enabled: true, allowedServers: ['server'] };

  it('refuses an elicitation the policy denies', async () => {
    await expect(
      resolveElicitation({
        policy: { enabled: false, allowedServers: ['server'] },
        serverName: 'server',
        request: emptySchemaRequest,
        lane: lane({ kind: 'approve' }),
      }),
    ).resolves.toEqual({ disposition: 'refused', reason: 'elicitation disabled' });
    await expect(
      resolveElicitation({
        policy: { enabled: true, allowedServers: ['other'] },
        serverName: 'server',
        request: emptySchemaRequest,
        lane: lane({ kind: 'approve' }),
      }),
    ).resolves.toMatchObject({ disposition: 'refused' });
  });

  it('never lets the lane answer an elicitation that needs user data', async () => {
    const review = vi.fn(async () => ({ kind: 'approve' as const }));
    await expect(
      resolveElicitation({
        policy,
        serverName: 'server',
        request: { message: 'Token?', schema: { properties: { token: { type: 'string' } } } },
        lane: { review },
      }),
    ).resolves.toEqual({ disposition: 'user', reason: 'elicitation requires human input' });
    expect(review).not.toHaveBeenCalled();
  });

  it('auto-accepts only a field-free elicitation the reviewer approves', async () => {
    await expect(
      resolveElicitation({
        policy,
        serverName: 'server',
        request: emptySchemaRequest,
        lane: lane({ kind: 'approve' }),
      }),
    ).resolves.toMatchObject({ disposition: 'auto-accepted' });
  });

  it('defers an approved-by-nobody elicitation to the user', async () => {
    await expect(
      resolveElicitation({
        policy,
        serverName: 'server',
        request: emptySchemaRequest,
        lane: lane({ kind: 'unclear' }),
      }),
    ).resolves.toMatchObject({ disposition: 'user' });
    await expect(
      resolveElicitation({
        policy,
        serverName: 'server',
        request: emptySchemaRequest,
        lane: undefined,
      }),
    ).resolves.toEqual({ disposition: 'user', reason: 'no reviewer configured' });
  });
});

describe('AgentReviewerLaneService', () => {
  function reviewerService(
    section: ReviewerSectionConfig | undefined,
    captured: unknown[] = [],
  ): { service: AgentReviewerLaneService; installed: (ReviewerLane | undefined)[] } {
    const installed: (ReviewerLane | undefined)[] = [];
    const config = {
      _serviceBrand: undefined,
      get: () => section,
    } as unknown as IConfigService;
    const requester = {
      _serviceBrand: undefined,
      prepareTurnConfig: () => undefined,
      currentCredentialProvider: () => undefined,
      credentialProviderForTurn: () => undefined,
      request: async (overrides: unknown) => {
        captured.push(overrides);
        return {
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: '{"decision":"approve"}' }],
            toolCalls: [],
          },
          usage: emptyUsage(),
        };
      },
      start: () => {
        throw new Error('reviewer lane uses request()');
      },
    } as unknown as IAgentLLMRequesterService;
    const approval = {
      _serviceBrand: undefined,
      setReviewerLane: (next: ReviewerLane | undefined) => {
        installed.push(next);
      },
    } as unknown as IAgentToolApprovalService;
    const service = new AgentReviewerLaneService(config, requester, approval);
    return { service, installed };
  }

  it('installs nothing when the reviewer is disabled', () => {
    const { service, installed } = reviewerService(undefined);
    expect(service.lane).toBeUndefined();
    expect(installed).toEqual([undefined]);
  });

  it('installs a lane carrying the configured timeout and model', () => {
    const { service, installed } = reviewerService({
      enabled: true,
      model: 'review-model',
      timeoutMs: 4321,
      samples: 2,
    });
    expect(service.llm?.timeoutMs).toBe(4321);
    expect(service.llm?.modelAlias).toBe('review-model');
    expect(installed).toHaveLength(1);
    expect(installed[0]).toBe(service.lane);
  });

  it('clears the installed lane on dispose', () => {
    const { service, installed } = reviewerService({ enabled: true });
    service.dispose();
    expect(installed.at(-1)).toBeUndefined();
  });

  it('asks the requester for an isolated, tool-free review request', async () => {
    const captured: unknown[] = [];
    const { service } = reviewerService({ enabled: true, model: 'review-model' }, captured);
    await service.llm?.review(request, new AbortController().signal);
    const overrides = captured[0] as {
      messages: { role: string }[];
      tools: unknown[];
      isolated: boolean;
      modelAlias: string;
      source: { type: string; requestKind: string };
    };
    expect(overrides.isolated).toBe(true);
    expect(overrides.tools).toEqual([]);
    expect(overrides.modelAlias).toBe('review-model');
    expect(overrides.messages).toHaveLength(1);
    expect(overrides.messages[0]?.role).toBe('user');
    expect(overrides.source).toMatchObject({ type: 'operation', requestKind: 'reviewer' });
  });

  it('feeds the reviewer only the ask payload', async () => {
    const captured: unknown[] = [];
    const { service } = reviewerService({ enabled: true }, captured);
    await service.llm?.review(request, new AbortController().signal);
    const overrides = captured[0] as { messages: { content: { text: string }[] }[] };
    const text = overrides.messages[0]?.content[0]?.text ?? '';
    expect(text).toContain('Write:/repo/src/app.ts');
    expect(text).not.toContain('assistant');
  });
});

describe('reviewerModelFromRequester', () => {
  it('rejects when the requester rejects', async () => {
    const requester = {
      request: async () => {
        throw new Error('provider down');
      },
    } as unknown as IAgentLLMRequesterService;
    const model = reviewerModelFromRequester(requester, {});
    await expect(
      model.complete({
        systemPrompt: 's',
        userPrompt: 'u',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('provider down');
  });
});
describe('auto-mode reviewer admission', () => {
  it('reviews an auto-mode ask when the lane opts in', async () => {
    const outcome = await admitReviewer({
      ...base,
      policyName: 'auto-mode-classifier',
      decision: 'ask',
      lane: { ...lane({ kind: 'approve', note: 'local write' }), allowAutoMode: true },
    });
    expect(outcome).toEqual({ kind: 'approve', note: 'local write' });
  });

  it('defers an auto-mode ask without the opt-in', async () => {
    const outcome = await admitReviewer({
      ...base,
      policyName: 'auto-mode-classifier',
      decision: 'ask',
      lane: lane({ kind: 'approve' }),
    });
    expect(outcome.kind).toBe('defer');
    if (outcome.kind === 'defer') expect(outcome.why).toContain('not reviewable');
  });

  it('still refuses a shell ask with the opt-in', async () => {
    const outcome = await admitReviewer({
      ...base,
      policyName: 'auto-mode-classifier',
      decision: 'ask',
      request: { ...request, display: { kind: 'command', command: 'rm -rf /' } },
      lane: { ...lane({ kind: 'approve' }), allowAutoMode: true },
    });
    expect(outcome.kind).toBe('defer');
    if (outcome.kind === 'defer') expect(outcome.why).toContain('outside reviewer scope');
  });
});
