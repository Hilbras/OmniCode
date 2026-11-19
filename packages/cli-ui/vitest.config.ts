import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-cli-ui',
    include: ['test/**/*.test.ts'],
  },
});
