import { defineConfig } from 'vitest/config';

// Lightweight config for server-only unit tests — no Vite/React transform overhead.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
