import 'server-only';

import { P } from '@/lib/permissions';
import { requirePermission } from '@/server/auth/session';

/**
 * Reads for the people in a school.
 *
 * <p>Everything goes through a tenant-bound transaction, so the rows come back scoped by the
 * client extension and by the database's own policies. Neither is written here.
 */

export const PEOPLE_PATH = '/settings/people';

/**
 * Everyone with a membership at this school, invited or active.
 *
 * <p>Only the fields a list needs. A user row carries a password hash and an invite token digest
 * and neither has any business leaving the server, so they are not selected rather than being
 * selected and then forgotten about.
 */
export async function listPeople() {
  const { transaction } = await requirePermission(P.USER_VIEW);

  return transaction((db) =>
    db.membership.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        principalType: true,
        invitedAt: true,
        acceptedAt: true,
        user: {
          select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true },
        },
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    }),
  );
}

/** The roles an invitation may assign: this school's own, plus the shared system templates. */
export async function assignableRoles() {
  const { transaction } = await requirePermission(P.USER_INVITE);

  return transaction((db) =>
    db.role.findMany({
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, code: true, tenantId: true },
    }),
  );
}

export type PersonRow = Awaited<ReturnType<typeof listPeople>>[number];
export type AssignableRole = Awaited<ReturnType<typeof assignableRoles>>[number];
