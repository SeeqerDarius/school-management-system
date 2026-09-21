import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from '@/server/db';

/**
 * Binds the request context the database's row-level security policies read.
 *
 * <h2>Why this exists</h2>
 * The policies added in `20260921030000_tenant_rls_policies` decide what a query may see from
 * three settings: `app.tenant_id`, `app.user_id` and `app.sign_in_email`. They are set with
 * `set_config(..., true)`, which scopes them to the current transaction — so they must be set
 * *inside* one, and every query that depends on them has to run in that same transaction.
 *
 * <p>A query issued outside a transaction has no settings bound, and every tenant policy treats
 * an unbound tenant as "no rows". That is deliberate: the failure mode of forgetting to bind is
 * an empty result, never another school's data.
 *
 * <h2>Why transaction-scoped rather than session-scoped</h2>
 * `SET` without `LOCAL` would persist on the connection and outlive the request. Behind a
 * transaction-mode pooler — Supabase's Supavisor, which is what `DATABASE_URL` points at — the
 * next request to borrow that connection would inherit the previous request's tenant. That is
 * the worst available failure: not a leak of nothing, but a leak of somebody.
 */

/** What the current unit of work is allowed to see. Anything absent binds as unset. */
export interface RequestContext {
  /** The school being acted for. Absent on the sign-in path, which runs before one is chosen. */
  tenantId?: string | null | undefined;
  /** The signed-in user, where the session has established one. */
  userId?: string | null | undefined;
  /** The address being authenticated. Set during sign-in only, and never alongside a tenant. */
  signInEmail?: string | null | undefined;
}

/**
 * Issues the three `set_config` calls on an open transaction.
 *
 * <p>Exported because the tenant-scoped client binds the same way; there is one definition of
 * what "bound" means, so the two cannot drift.
 *
 * <p>Absent values are bound as the empty string rather than skipped. Skipping would leave
 * whatever the connection last held, which is exactly the pooler hazard above.
 */
export async function bindRequestContext(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  context: RequestContext,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId ?? ''}, true)`;
  await tx.$executeRaw`SELECT set_config('app.user_id', ${context.userId ?? ''}, true)`;
  await tx.$executeRaw`SELECT set_config('app.sign_in_email', ${context.signInEmail ?? ''}, true)`;
}

/**
 * Runs `work` in one transaction with the context bound, on the **unscoped** client.
 *
 * <p>For the three things that legitimately have no tenant: authenticating somebody, listing the
 * schools they may enter, and recording a security event for a sign-in that failed. Everything
 * else belongs in `inTenantTransaction`, which adds the application-side scope on top.
 */
export async function withRequestContext<T>(
  context: RequestContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await bindRequestContext(tx, context);
    return work(tx);
  });
}
