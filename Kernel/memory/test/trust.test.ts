import { describe, expect, it } from 'vitest';

import { issueMemoryAuthority } from '#/contracts/memoryAuthority';
import type { MemoryEvidence } from '#/contracts/memoryTypes';
import {
  checkTierAdmission,
  evaluateInitialTrust,
  evaluatePromotion,
  verificationFromEvidence,
} from '#/trust/trustPolicy';

import { captureInput, createHarness, evidenceFor, REPO_A, repoScope } from './helpers';

const present: readonly MemoryEvidence[] = [
  { kind: 'file', ref: 'package.json', state: 'present', fingerprint: 'abc', observedAt: 1 },
];

const withoutFingerprint: readonly MemoryEvidence[] = [
  { kind: 'tool', ref: 'tool-call-7', state: 'present', observedAt: 1 },
];

describe('trust model', () => {
  it('labels trust levels from unverified to system', () => {
    expect(evaluateInitialTrust({ sourceType: 'model_inference', origin: 'model', evidence: [] }, 1)).toEqual({
      trust: 'unverified',
      reason: 'model-authored inference; repetition and rewrites never raise trust',
      verification: { status: 'unverified', method: 'none' },
    });
    expect(evaluateInitialTrust({ sourceType: 'user_statement', origin: 'user', evidence: [] }, 1).trust).toBe(
      'trusted',
    );
    expect(
      evaluateInitialTrust({ sourceType: 'repository_file', origin: 'application', evidence: present }, 1).trust,
    ).toBe('verified');
    expect(
      evaluateInitialTrust(
        {
          sourceType: 'repository_file',
          origin: 'application',
          evidence: present,
          authority: issueMemoryAuthority('host', 1),
        },
        1,
      ).trust,
    ).toBe('system');
  });

  it('never verifies a source type without present, fingerprinted evidence', () => {
    expect(verificationFromEvidence(withoutFingerprint, 5)).toEqual({ status: 'unverified', method: 'none' });
    expect(
      verificationFromEvidence(
        [{ kind: 'file', ref: 'a', state: 'changed', fingerprint: 'x', observedAt: 1 }],
        5,
      ),
    ).toEqual({ status: 'unverified', method: 'none' });
    expect(evaluateInitialTrust({ sourceType: 'test_result', origin: 'application', evidence: withoutFingerprint }, 1).trust).toBe(
      'unverified',
    );
  });

  it('refuses to let a model attribute a statement to the user', () => {
    const decision = evaluateInitialTrust({ sourceType: 'user_statement', origin: 'model', evidence: [] }, 1);
    expect(decision.trust).toBe('unverified');
    expect(decision.reason).toContain('cannot be attributed to the user');
  });

  it('refuses to let repetition by a model raise trust', async () => {
    const harness = createHarness();
    const first = await harness.service.capture(
      captureInput('the team prefers pnpm', { sourceType: 'model_inference', origin: 'model' }),
    );
    expect(first.status).toBe('stored');
    expect(first.record?.trust).toBe('unverified');

    for (const attempt of [2, 3, 4, 5]) {
      const rewritten = await harness.service.capture(
        captureInput(`the team prefers pnpm (restatement ${attempt})`, {
          sourceType: 'derived',
          origin: 'model',
          derivedFrom: [first.id as string],
        }),
      );
      expect(rewritten.status).toBe('stored');
      expect(rewritten.record?.trust).toBe('unverified');
    }
    const stored = await harness.service.list({ projectId: REPO_A });
    expect(stored.every((record) => record.trust === 'unverified')).toBe(true);
  });

  it('promotes by evidence, by user confirmation, and never by model request', () => {
    const unverified = { trust: 'unverified', origin: 'model', sourceType: 'model_inference' } as never;
    expect(evaluatePromotion(unverified, 'verified', 'model', { at: 1, evidence: present }).allowed).toBe(false);
    expect(
      evaluatePromotion(unverified, 'verified', 'application', { at: 1, evidence: present }).allowed,
    ).toBe(true);
    expect(
      evaluatePromotion(unverified, 'verified', 'application', { at: 1, evidence: withoutFingerprint }).allowed,
    ).toBe(false);
    expect(evaluatePromotion(unverified, 'trusted', 'model', { at: 1, evidence: [] }).allowed).toBe(false);
    expect(evaluatePromotion(unverified, 'trusted', 'user', { at: 1, evidence: [] }).allowed).toBe(true);
  });

  it('requires an application authority for system trust', () => {
    const unverified = { trust: 'trusted', origin: 'user', sourceType: 'user_statement' } as never;
    expect(evaluatePromotion(unverified, 'system', 'user', { at: 1 }).allowed).toBe(false);
    expect(
      evaluatePromotion(unverified, 'system', 'application', { at: 1, authority: issueMemoryAuthority('host', 1) })
        .allowed,
    ).toBe(true);
  });

  it('does not let access count influence promotion', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('a claim that keeps being retrieved', { sourceType: 'model_inference', origin: 'model' }),
    );
    const id = stored.id as string;
    const cold = await harness.service.get(id);
    for (let index = 0; index < 50; index += 1) await harness.service.noteAccess([id], harness.clock.now());
    const record = await harness.service.get(id);
    expect(record?.accessCount).toBe(50);

    expect(evaluatePromotion(record as never, 'trusted', 'model', { at: 1 })).toEqual(
      evaluatePromotion(cold as never, 'trusted', 'model', { at: 1 }),
    );
    expect(evaluatePromotion(record as never, 'trusted', 'model', { at: 1 }).allowed).toBe(false);
    expect(evaluatePromotion(record as never, 'system', 'application', { at: 1 }).allowed).toBe(false);
  });

  it('counts an access only for a record that is still active', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(captureInput('a stored claim about caching'));
    const id = stored.id as string;
    expect(await harness.service.noteAccess([id], harness.clock.now())).toBe(1);
    expect((await harness.service.get(id))?.accessCount).toBe(1);

    await harness.service.invalidate(id, 'user corrected this');
    expect(await harness.service.noteAccess([id], harness.clock.now())).toBe(0);
    expect((await harness.service.get(id))?.accessCount).toBe(1);
  });
});

describe('tier admission', () => {
  it('rejects canonical policies without an authority', () => {
    const violations = checkTierAdmission({
      tier: 'canonical',
      category: 'policy',
      origin: 'user',
      trust: 'verified',
      approval: { by: 'user', at: 1, reason: 'user asked' },
    });
    expect(violations.map((violation) => violation.rule)).toContain('canonical.policy');
  });

  it('accepts canonical policies from the host application', () => {
    expect(
      checkTierAdmission({
        tier: 'canonical',
        category: 'policy',
        origin: 'application',
        trust: 'system',
        authority: issueMemoryAuthority('host', 1),
      }),
    ).toEqual([]);
  });

  it('rejects model-authored and unverified canonical instructions', () => {
    const modelAuthored = checkTierAdmission({
      tier: 'canonical',
      category: 'instruction',
      origin: 'model',
      trust: 'verified',
      approval: { by: 'user', at: 1, reason: 'looks right' },
    });
    expect(modelAuthored.map((violation) => violation.rule)).toContain('canonical.instruction.origin');

    const unverified = checkTierAdmission({
      tier: 'canonical',
      category: 'instruction',
      origin: 'user',
      trust: 'unverified',
      approval: { by: 'user', at: 1, reason: 'ok' },
    });
    expect(unverified.map((violation) => violation.rule)).toContain('canonical.instruction.trust');
  });

  it('rejects canonical instructions that nobody approved', () => {
    const violations = checkTierAdmission({
      tier: 'canonical',
      category: 'instruction',
      origin: 'user',
      trust: 'trusted',
    });
    expect(violations.map((violation) => violation.rule)).toContain('canonical.instruction.approval');
  });

  it('rejects task state in distilled memory and policy in working memory', () => {
    expect(
      checkTierAdmission({ tier: 'distilled', category: 'task', origin: 'application', trust: 'trusted' }).map(
        (violation) => violation.rule,
      ),
    ).toEqual(['tier.category']);
    expect(
      checkTierAdmission({ tier: 'working', category: 'policy', origin: 'application', trust: 'trusted' }).map(
        (violation) => violation.rule,
      ),
    ).toEqual(['tier.category']);
  });
});

describe('capture-level trust enforcement', () => {
  it('records user statements as trusted with an explicit reason', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('always run pnpm lint before committing', {
        category: 'preference',
        sourceType: 'user_statement',
        origin: 'user',
        tier: 'distilled',
      }),
    );
    expect(stored.record?.trust).toBe('trusted');
    expect(stored.record?.trustReason).toBe('stated directly by the user');
  });

  it('treats a user correction as an explicit, auditable signal', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('the build command is pnpm build', {
        category: 'instruction',
        sourceType: 'user_correction',
        origin: 'user',
      }),
    );
    expect(stored.record?.trust).toBe('trusted');
    expect(stored.record?.sourceType).toBe('user_correction');
  });

  it('keeps derived memories linked to their sources', async () => {
    const harness = createHarness();
    const source = await harness.service.capture(
      captureInput('vitest is the test runner', { sourceType: 'repository_file', evidence: evidenceFor('package.json') }),
    );
    const derived = await harness.service.capture(
      captureInput('tests are run with vitest', { sourceType: 'derived', origin: 'model', derivedFrom: [source.id as string] }),
    );
    expect(derived.record?.derivedFrom).toEqual([source.id]);
    expect(derived.record?.trust).toBe('unverified');
  });

  it('rejects derived memories that reference an unknown source', async () => {
    const harness = createHarness();
    const result = await harness.service.capture(
      captureInput('derived from nothing', { sourceType: 'derived', origin: 'model', derivedFrom: ['mem_missing'] }),
    );
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('unknown sources');
  });

  it('verifies repository evidence through the verification policy', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('this repository is a pnpm workspace', {
        sourceType: 'repository_file',
        evidence: evidenceFor('pnpm-workspace.yaml'),
        repoRevision: 'abc123',
      }),
    );
    expect(stored.record?.trust).toBe('verified');
    expect(stored.record?.verification).toEqual({ status: 'verified', checkedAt: expect.any(Number), method: 'evidence' });
    expect(stored.record?.repoRevision).toBe('abc123');
  });

  it('resolves conflicts deterministically without favouring the newest statement', async () => {
    const harness = createHarness();
    const scope = repoScope(REPO_A);
    const verified = await harness.service.capture(
      captureInput('the default port is 5173', {
        category: 'fact',
        subject: 'devserver.port',
        sourceType: 'repository_file',
        evidence: evidenceFor('vite.config.ts'),
      }),
    );
    const inferred = await harness.service.capture(
      captureInput('the default port is probably 3000', {
        category: 'fact',
        subject: 'devserver.port',
        sourceType: 'model_inference',
        origin: 'model',
      }),
    );
    expect(verified.record?.trust).toBe('verified');
    expect(inferred.record?.trust).toBe('unverified');

    const active = await harness.service.list({ projectId: REPO_A, limit: 10 });
    const subjects = active.map((record) => record.subject);
    expect(subjects).toEqual(['devserver.port', 'devserver.port']);
    for (const record of active) {
      expect(record.lifecycle).toBe('active');
      expect(record.conflictsWith).toHaveLength(1);
    }
    expect(scope.tier).toBe('repository');
  });

  it('supersedes a weaker active statement when a stronger one arrives', async () => {
    const harness = createHarness();
    const weak = await harness.service.capture(
      captureInput('the retry count is 1', { subject: 'http.retries', sourceType: 'model_inference', origin: 'model' }),
    );
    const strong = await harness.service.capture(
      captureInput('the retry count is 3', {
        subject: 'http.retries',
        sourceType: 'user_correction',
        origin: 'user',
      }),
    );
    expect(weak.record?.trust).toBe('unverified');
    expect(strong.record?.trust).toBe('trusted');
    expect(strong.record?.supersedes).toBe(weak.id as string);

    const superseded = await harness.service.get(weak.id as string);
    expect(superseded?.lifecycle).toBe('superseded');
    expect(superseded?.supersededBy).toBe(strong.id);
  });
});