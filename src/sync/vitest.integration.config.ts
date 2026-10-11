import { defineConfig } from 'vitest/config';

/** Integration suite: talks to the REAL Firebase project. Run with `npm run test:sync`. */
export default defineConfig({
  test: {
    include: ['src/sync/**/*.itest.ts'],
    environment: 'node',
    testTimeout: 90000,
    hookTimeout: 90000,
    fileParallelism: false,
  },
});
