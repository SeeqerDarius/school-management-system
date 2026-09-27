import 'server-only';

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/server/auth/options';
import { inTenantTransaction, type TenantTx } from '@/server/tenant-scope';

/**
 * Reading and enforcing the current session.
 *
 * <p>Every one of these runs on the server. The client is never trusted for identity, tenant or
 * permission — it is trusted only to render what it was given.
 */

export interface ActiveSession {
  userId: string;
  membershipId: string;
  tenantId: string;
  tenantSlug: string;
  /** What the school calls itself, for anywhere a person has to read it. */
  tenantName: string;
  permissions: Set<string>;
  /**
   * Whether this membership is staff, a guardian or a pupil.
   *
   * <p>Not interchangeable with a permission. A permission says what somebody may do; it
   * cannot say to whom, and the two questions have different answers for a parent.
   */
  principalType: string;
  /** The guardian or student row this membership is, where it is one. */
  principalId: string | null;
  /**
   * Runs database work for this school.
   *
   * <p>A runner rather than a client, because the tenant has to be bound inside a transaction
   * for the row-level security policies to see it — see `db-context.ts`. Handing out a bare
   * client would let a caller query outside one, which under the restricted role returns
   * nothing and looks like missing data rather than a missing binding.
   *
   * ```ts
   * const years = await session.transaction((db) => db.academicYear.findMany());
   * ```
   */
  transaction: <T>(work: (db: TenantTx) => Promise<T>) => Promise<T>;
}

/** The raw session, or null. Use the `require*` helpers unless you genuinely handle null. */
export async function currentSession() {
  return getServerSession(authOptions);
}

/**
 * Requires a signed-in user with a school selected.
 *
 * <p>Redirects rather than throwing, because every caller is a page or an action and the right
 * response to "not signed in" is to send them somewhere they can sign in — not a stack trace.
 */
export async function requireActiveSession(): Promise<ActiveSession> {
  const session = await currentSession();

  if (!session?.userId) {
    redirect('/sign-in');
  }
  if (!session.activeMembershipId || !session.tenantId) {
    // Signed in but no school chosen. Legitimate immediately after sign-in.
    redirect('/choose-school');
  }

  const active = session.memberships?.find((m) => m.id === session.activeMembershipId);

  return {
    userId: session.userId,
    membershipId: session.activeMembershipId,
    tenantId: session.tenantId,
    tenantSlug: session.tenantSlug ?? '',
    tenantName: active?.tenant.displayName ?? session.tenantSlug ?? '',
    permissions: new Set(session.permissions ?? []),
    principalType: active?.principalType ?? 'STAFF',
    principalId: active?.principalId ?? null,
    transaction: (work) =>
      inTenantTransaction({ tenantId: session.tenantId as string, userId: session.userId }, work),
  };
}

/**
 * Thrown when a signed-in user lacks the permission an action requires.
 *
 * <p>Carries the permission code so the log line says which one, while the message shown to the
 * user says only that they may not do this — naming the permission to the caller would map out
 * the authorization model for anyone probing it.
 */
export class PermissionDeniedError extends Error {
  constructor(public readonly required: string) {
    super('You do not have permission to perform this action');
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Requires a specific permission.
 *
 * <p>This is the only way authorization is expressed. There are no role-name comparisons: a role
 * is a bundle a school can redefine, while a permission code is a stable capability the code can
 * reason about.
 */
export async function requirePermission(permission: string): Promise<ActiveSession> {
  const session = await requireActiveSession();

  if (!session.permissions.has(permission)) {
    console.warn(
      `Permission denied: user=${session.userId} tenant=${session.tenantId} needed=${permission}`,
    );
    throw new PermissionDeniedError(permission);
  }

  return session;
}

/** Whether the current session holds a permission. For deciding what to render, never what to allow. */
export async function hasPermission(permission: string): Promise<boolean> {
  const session = await currentSession();
  return session?.permissions?.includes(permission) ?? false;
}
