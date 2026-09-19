import 'server-only';

import { PrismaClient } from '@prisma/client';

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
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
