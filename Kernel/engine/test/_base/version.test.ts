import { describe, expect, it } from 'vitest';

import { getCoreVersion } from '@hilbras/omnicode-base/version';

describe('version', () => {
  it('exposes a non-empty version string', () => {
    expect(typeof getCoreVersion()).toBe('string');
    expect(getCoreVersion().length).toBeGreaterThan(0);
  });
});
