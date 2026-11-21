import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    name: 'omnicode-web',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
}));
