import 'server-only';

import { PrismaClient } from '@prisma/client';

import { poolerSafeDatabaseUrl } from '@/lib/database-url';

/**
 * The Prisma client.
 *
 * <p>A module-level singleton, cached on `globalThis` in development so Next.js hot reloads do
 * not open a new connection pool on every edit and exhaust the database's connection limit
 * within a few minutes of work.
 *
 * <p>This is the **unscoped** client. It can read and write across every tenant, which is
 * correct for exactly three things: authentication before a tenant is known, platform
 * administration, and seeding. Everything else must go through {@link forTenant} in
 * `tenant-scope.ts`, which cannot forget the tenant filter.
 *
 * <p>The URL is passed through {@link poolerSafeDatabaseUrl} rather than being left to
 * Prisma's own `env("DATABASE_URL")` lookup. On Supabase's transaction pooler a missing
 * `pgbouncer=true` produces `prepared statement "s0" already exists` under concurrency —
 * intermittent, and naming nothing that points at the cause. That module explains why the
 * guard lives in code rather than in the runbook.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const datasourceUrl = poolerSafeDatabaseUrl(process.env.DATABASE_URL);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Omitted rather than passed as undefined: `datasourceUrl: undefined` is not the same as
    // absent to Prisma's overloads, and absent is what makes it fall back to the schema's own
    // env() binding — which is what should happen when there is nothing to normalise.
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
