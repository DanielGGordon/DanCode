import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/e2e/**', 'tests/e2e-shellhost/**', 'node_modules/**'],
    // Each test file gets its own fork (server/index.js uses module-level
    // singletons), and forks run sequentially so the shared tmux/socket
    // resources don't trample each other.
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        singleFork: false,
      },
    },
    fileParallelism: false,
  },
});
