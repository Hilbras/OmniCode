import { describe, expect, it } from 'vitest';

import { canTransmitToProvider, sensitivityAtMost } from '#/service/egress';
import { captureInput, createHarness, evidenceFor, REPO_A } from './helpers';

describe('memory sensitivity and egress', () => {
  it('excludes confidential and secret memories from the default retrieval ceiling', async () => {
    const { service } = createHarness();
    const internal = await service.capture(
      captureInput('the deploy target is staging', { evidence: evidenceFor('docs/deploy.md') }),
    );
    const secret = await service.capture(
      captureInput('the private key is in the vault', {
        sensitivity: 'secret',
        evidence: evidenceFor('docs/secret.md'),
      }),
    );

    const defaultView = await service.search({ query: 'deploy target', projectId: REPO_A });
    expect(defaultView.memories.map((memory) => memory.record.id)).toEqual([internal.id]);

    const secretView = await service.search({
      query: 'private key',
      projectId: REPO_A,
      maxSensitivity: 'secret',
      includeUntrusted: true,
    });
    expect(secretView.memories.map((memory) => memory.record.id)).toContain(secret.id);
  });

  it('never transmits a secret to a provider', () => {
    const capabilities = new Set(['provider:transmit'] as const);
    expect(canTransmitToProvider({ record: { sensitivity: 'secret' }, capabilities })).toBe(false);
    expect(canTransmitToProvider({ record: { sensitivity: 'confidential' }, capabilities })).toBe(true);
    expect(canTransmitToProvider({ record: { sensitivity: 'internal' }, capabilities: new Set() })).toBe(
      false,
    );
  });

  it('checks the sensitivity ceiling without widening scope', () => {
    expect(sensitivityAtMost({ sensitivity: 'internal' }, 'confidential')).toBe(true);
    expect(sensitivityAtMost({ sensitivity: 'secret' }, 'confidential')).toBe(false);
  });
});
