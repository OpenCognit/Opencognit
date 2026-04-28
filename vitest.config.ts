import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run server tests in Node environment
    environment: 'node',
    globals: true,
    // Include server-side test files
    include: ['server/**/*.test.ts'],
    // Exclude node_modules and dist
    exclude: ['node_modules', 'dist', '.git'],
    // Timeout for long-running tests
    testTimeout: 30000,
    // Fork-based isolation for DB safety
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ['./server/__tests__/setup.ts'],
    // Coverage config
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*.ts'],
      exclude: [
        'server/**/*.test.ts',
        'server/db/migrations/**',
        'server/db/client.ts',
        'server/index.ts',
      ],
    },
  },
  // Resolve .js imports in TypeScript files (Node ESM compat)
  resolve: {
    alias: {
      // Allow importing .js files that resolve to .ts
    },
  },
});
