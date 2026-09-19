import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The suites that need a real PostgreSQL. See the note in `vitest.config.ts`. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import outside a React Server Component. It is a bundler
      // guard, not a runtime one, and under Node there is no client to guard against — so it
      // is stubbed here. Without this, the modules most worth testing are the ones that
      // cannot be imported.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    // These share one database. Running files in parallel would have them deleting each
    // other's tenants mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
