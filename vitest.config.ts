import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      '!Kernel/minidb',
      'Kernel/*/vitest.config.ts',
      'apps/omnicode',
      'apps/omnicode-vis/server',
      'apps/omnicode-vis/web',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'Kernel/*/src/**/*.ts',
        'apps/*/src/**/*.ts',
        'apps/omnicode-vis/*/src/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      reporter: ['text', 'html'],
    },
  },
});
