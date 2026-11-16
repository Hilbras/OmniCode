import { defineConfig } from 'vitest/config';

// The app renders in a browser, but its logic under test is DOM-free: the pagination
// helpers and the route table. Keeping `environment: 'node'` matches the rest of the
// workspace and avoids a DOM implementation dependency.
export default defineConfig({
  test: {
    name: 'omnicode-web',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
