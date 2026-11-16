import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app-i18n',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
