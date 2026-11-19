import { describe, expect, it } from 'vitest';

import { checkSafetyLedger } from '../../../../scripts/check-safety-ledger.mjs';

const pin = {
  file: 'src/stub.ts',
  pattern: 'CAP = (\\d+)',
  value: '2',
  reason: 'test',
};

describe('checkSafetyLedger', () => {
  it('passes when every pinned value matches its source', () => {
    expect(checkSafetyLedger({ pins: { cap: pin } }, () => 'export const CAP = 2;')).toEqual([]);
  });

  it('fails on a drifted value (fail on base: guard did not exist)', () => {
    expect(checkSafetyLedger({ pins: { cap: pin } }, () => 'export const CAP = 99;')).toEqual([
      { id: 'cap', file: 'src/stub.ts', kind: 'value-drift', expected: '2', actual: '99' },
    ]);
  });

  it('fails when the pinned pattern is absent from the source', () => {
    expect(checkSafetyLedger({ pins: { cap: pin } }, () => 'export const OTHER = 2;')).toEqual([
      { id: 'cap', file: 'src/stub.ts', kind: 'value-drift', expected: '2', actual: undefined },
    ]);
  });

  it('requires an explicit ledger edit when a pinned declaration disappears', () => {
    expect(checkSafetyLedger({ pins: { cap: pin } }, () => undefined)).toEqual([
      { id: 'cap', file: 'src/stub.ts', kind: 'missing-declaration', expected: '2' },
    ]);
  });
});
