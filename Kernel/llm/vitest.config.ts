import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'omnicode-llm',
    include: ['test/**/*.test.ts'],
  },
});
