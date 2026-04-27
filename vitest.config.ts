import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run server tests in Node environment
    environment: 'node',
    // Include server-side test files
    include: ['server/**/*.test.ts'],
    // Exclude node_modules and dist
    exclude: ['node_modules', 'dist', '.git'],
    // Timeout for long-running tests
    testTimeout: 10000,
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
