import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**'],
    testTimeout: 20_000,
  },
});
