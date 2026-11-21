import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/omnicode-cli/vitest.config.ts',
      'apps/omnicode-inspect',
      'apps/omnicode-vis/server',
      'apps/omnicode-vis/web',
      'apps/web/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'packages/*/src/**/*.ts',
        'apps/*/src/**/*.ts',
        'apps/omnicode-vis/*/src/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      reporter: ['text', 'html'],
    },
  },
});
