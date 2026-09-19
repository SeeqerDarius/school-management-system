import 'server-only';

import { db } from '@/server/db';

/**
 * Resolves what a membership may actually do.
 *
 * <p>One definition, used by every access check, so there is no second implementation to drift
 * out of agreement. Permissions come from the roles a membership holds, plus per-person
 * overrides — and **DENY always beats ALLOW**, which is what makes it possible to take one
 * sensitive capability away from an individual without dismantling their role.
 *
 * <p>Expired grants are ignored, so a temporary elevation lapses on its own rather than
 * depending on somebody remembering to revoke it.
 */
export async function effectivePermissions(membershipId: string): Promise<Set<string>> {
  const [roleGrants, directGrants] = await Promise.all([
    db.rolePermission.findMany({
      where: { role: { memberEntries: { some: { membershipId } } } },
      select: { permission: { select: { code: true } } },
    }),
    db.membershipPermissionGrant.findMany({
      where: {
        membershipId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { effect: true, permission: { select: { code: true } } },
    }),
  ]);

  const allowed = new Set(roleGrants.map((g) => g.permission.code));

  for (const grant of directGrants) {
    if (grant.effect === 'ALLOW') allowed.add(grant.permission.code);
  }
  // Applied after, unconditionally: a DENY is not negotiable by any role.
  for (const grant of directGrants) {
    if (grant.effect === 'DENY') allowed.delete(grant.permission.code);
  }

  return allowed;
}

/**
 * The schools a user may enter.
 *
 * <p>Suspended and cancelled tenants are excluded: their data is untouched and the membership
 * survives, but nobody can work in a school whose subscription has lapsed.
 */
export async function membershipsForUser(userId: string) {
  return db.membership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      tenant: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    },
    select: {
      id: true,
      tenantId: true,
      principalType: true,
      tenant: { select: { slug: true, displayName: true } },
    },
    orderBy: { tenant: { displayName: 'asc' } },
  });
}
