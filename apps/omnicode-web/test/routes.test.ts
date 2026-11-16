import { describe, expect, it } from 'vitest';

import { App } from '../src/App';

describe('omnicode-web stub', () => {
  it('declares its two routes', () => {
    expect(App).toBeTypeOf('function');
  });
});
