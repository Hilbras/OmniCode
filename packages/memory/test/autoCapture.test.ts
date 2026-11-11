import { describe, expect, it } from 'vitest';

import { extractAutoCaptureStatements } from '#/layers/autoCapture';

describe('extractAutoCaptureStatements', () => {
  it('captures an explicit save request', () => {
    expect(extractAutoCaptureStatements('save it to memory my name is Hassan')).toEqual([
      { content: 'my name is Hassan', category: 'fact', scope: 'global' },
    ]);
  });

  it('captures a name as a global fact', () => {
    expect(extractAutoCaptureStatements('my name is Hassan')).toEqual([
      { content: 'my name is Hassan', category: 'fact', scope: 'global' },
    ]);
  });

  it('captures a remembered project fact', () => {
    expect(extractAutoCaptureStatements('Remember that the deploy target is staging.')).toEqual([
      { content: 'the deploy target is staging', category: 'fact', scope: 'repository' },
    ]);
  });

  it('ignores ordinary conversation', () => {
    expect(extractAutoCaptureStatements('do you know my name?')).toEqual([]);
  });
});
