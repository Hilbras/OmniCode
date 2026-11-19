import { describe, expect, it } from 'vitest';

import {
  classifyDeny,
  isTrustedAnswerAllowed,
} from '#/agent/permissionPolicy/denyTaxonomy';

describe('classifyDeny', () => {
  it('treats exfiltration and bypass-after-denial as hard denies', () => {
    expect(classifyDeny('exfiltration')).toBe('hard');
    expect(classifyDeny('bypass-after-denial')).toBe('hard');
  });

  it('treats ordinary classifier categories as soft denies', () => {
    expect(classifyDeny('ask')).toBe('soft');
    expect(classifyDeny('mcp_grant_ambiguity')).toBe('soft');
    expect(classifyDeny('context_missing_edit_intent')).toBe('soft');
  });
});

describe('isTrustedAnswerAllowed', () => {
  it('allows an approved soft-denied action with no prior rejection', () => {
    expect(isTrustedAnswerAllowed({
      fingerprint: 'Lookup:{}', deniedFingerprints: new Set(), category: 'ask',
    })).toBe(true);
  });

  it('refuses an action the user has already rejected (bypass-after-denial)', () => {
    expect(isTrustedAnswerAllowed({
      fingerprint: 'Lookup:{}', deniedFingerprints: new Set(['Lookup:{}']), category: 'ask',
    })).toBe(false);
  });

  it('refuses hard-deny categories even without a prior rejection', () => {
    expect(isTrustedAnswerAllowed({
      fingerprint: 'Bash(curl)', deniedFingerprints: new Set(), category: 'exfiltration',
    })).toBe(false);
  });
});
