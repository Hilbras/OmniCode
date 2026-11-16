import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'kernel-api',
    include: ['test/**/*.test.ts'],
    // This suite drives in-process transports, MCP, and OAuth round-trips where a
    // single case takes 2–3s. Under parallel file execution the 5s default trips
    // on load, not on a real failure, so the gate has to allow headroom.
    testTimeout: 20_000,
  },
});