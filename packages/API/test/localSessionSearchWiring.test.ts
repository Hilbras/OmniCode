import { describe, expect, it } from 'vitest';

import {
  getScopedServiceDescriptors,
  ISessionSearchService,
  LifecycleScope,
} from '@hilbras/omnicode-core';

import '../src/runtime-primitives';

describe('local session search wiring', () => {
  it('overrides the app-scope service with the file-backed source', () => {
    const entry = getScopedServiceDescriptors(LifecycleScope.App).find(
      (candidate) => candidate.id === ISessionSearchService,
    );
    expect(entry?.domain).toBe('sessionSearchLocal');
  });
});
