import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/e2e/**', 'tests/e2e-shellhost/**', 'node_modules/**'],
  },
});
