import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Two suites, kept deliberately separate.
 *
 * <p>`npm test` runs the fast ones: pure functions, no database, no network. They are meant to
 * run on every save without anybody weighing up whether it is worth the wait.
 *
 * <p>`npm run test:db` runs the ones that need real PostgreSQL — tenant isolation above all,
 * which cannot be proved against a mock, because a mock will happily agree that the filter was
 * applied. They are excluded from the default run rather than skipped inside it: a suite that
 * quietly skips itself when a variable is missing is a suite that stops running and never says
 * so.
 */
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
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'tests/db/**'],
  },
});
