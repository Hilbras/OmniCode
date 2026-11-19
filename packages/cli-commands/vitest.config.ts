import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-cli-commands',
    include: ['test/**/*.test.ts'],
  },
});
