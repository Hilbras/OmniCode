import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    noExternal: [/\/packages\/engine\//, /\/packages\/Tools\//, /\/packages\/Addons\//, /\/packages\/memory\//],
  },
  test: {
    name: 'omnicode-features-integration',
    environment: 'node',
    include: ['test/**/*.{test,e2e,integration}.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
  },
});
