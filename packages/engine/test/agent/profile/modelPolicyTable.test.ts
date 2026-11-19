import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_POLICY_TABLE,
  resolveModelPolicy,
  validateModelPolicyTable,
  type ModelPromptPolicy,
} from '#/agent/profile/modelPolicyTable';

describe('validateModelPolicyTable', () => {
  it('accepts the built-in table', () => {
    expect(validateModelPolicyTable(DEFAULT_MODEL_POLICY_TABLE)).toEqual([]);
  });

  it('rejects duplicate ids, blank overlays, bad matches and weakening flags', () => {
    const bad: ModelPromptPolicy[] = [
      { id: 'x', match: '*' },
      { id: 'x', match: '*' },
      { id: 'blank', match: 'gpt-*', promptOverlay: '   ' },
      { id: 'bad', match: '' },
      { id: 'weak', match: 'gpt-*', allowParallelTools: true, requireVerification: false },
    ];
    expect(validateModelPolicyTable(bad).map((issue) => issue.reason)).toEqual([
      'duplicate-id', 'empty-overlay', 'invalid-match', 'weakening-flag',
    ]);
  });
});

describe('resolveModelPolicy', () => {
  it('prefers an exact id over a prefix over the wildcard', () => {
    const table: ModelPromptPolicy[] = [
      { id: 'default', match: '*', promptOverlay: 'default' },
      { id: 'family', match: 'gpt-*', promptOverlay: 'family' },
      { id: 'exact', match: 'gpt-4o', promptOverlay: 'exact' },
    ];
    expect(resolveModelPolicy(table, 'gpt-4o')?.id).toBe('exact');
    expect(resolveModelPolicy(table, 'gpt-4.1')?.id).toBe('family');
    expect(resolveModelPolicy(table, 'claude-3')?.id).toBe('default');
  });

  it('returns undefined for an empty table', () => {
    expect(resolveModelPolicy([], 'gpt-4o')).toBeUndefined();
  });
});
