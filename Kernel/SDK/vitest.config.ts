import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@hilbras/omnicode-auth/provider-credential',
        replacement: fileURLToPath(
          new URL('../../packages/omnicode-auth/src/provider-credential.ts', import.meta.url),
        ),
      },
      {
        find: '@hilbras/omnicode-auth',
        replacement: fileURLToPath(new URL('../../packages/omnicode-auth/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'omnicode-sdk',
    env: {
      OMNICODE_LOG_LEVEL: 'off',
    },
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
