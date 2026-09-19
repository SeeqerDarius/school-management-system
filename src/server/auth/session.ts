import 'server-only';

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/server/auth/options';
import { forTenant, type TenantClient } from '@/server/tenant-scope';

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
  /** A Prisma client that cannot see outside this tenant. */
  db: TenantClient;
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
    db: forTenant(session.tenantId),
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
