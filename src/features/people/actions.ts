'use server';

import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';

import { PEOPLE_PATH } from '@/features/people/data';
import { inviteMemberInput, redeemInvitationInput } from '@/features/people/schema';
import {
  hashInvitationToken,
  invitationUrl,
  isInvitationExpired,
  issueInvitation,
} from '@/lib/invitation';
import { P } from '@/lib/permissions';
import { recordAudit } from '@/server/audit';
import { PermissionDeniedError, requirePermission } from '@/server/auth/session';
import { withRequestContext } from '@/server/db-context';
import { inTenantTransaction } from '@/server/tenant-scope';

/**
 * Invitations.
 *
 * <p>Accounts are invited, never self-registered: there is no sign-up route, and holding an
 * email address is not a route into a school. These two actions are the only way an account
 * comes into existence, which is why the checks here are the product rule and not a formality.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
  /**
   * The link to hand to the person, returned once and never stored in a readable form.
   *
   * <p>Email delivery is not wired (there is no provider configured), so the invitation reaches
   * its recipient because the person who issued it passes this on. That is a real product
   * behaviour rather than a stopgap — a Ghanaian school office is as likely to send it over
   * WhatsApp as by email — but it does mean redemption does **not** prove control of the
   * address, which is why `emailVerified` stays false.
   */
  readonly invitationLink?: string;
}

/** A rule the request broke, phrased for the person who will read it. */
class RuleViolation extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'RuleViolation';
  }
}

async function run(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RuleViolation) {
      return {
        ok: false,
        message: error.message,
        ...(error.field ? { fieldErrors: { [error.field]: error.message } } : {}),
      };
    }
    if (error instanceof PermissionDeniedError) {
      return { ok: false, message: error.message };
    }
    // Never swallowed into a success (invariant I-8). The detail stays in the server log; the
    // person gets something true and useless to an attacker.
    console.error('people action failed', error);
    return { ok: false, message: 'Something went wrong. Nothing was changed.' };
  }
}

// =====================================================================================
// Issuing
// =====================================================================================

export async function inviteMemberAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = inviteMemberInput.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName'),
    principalType: formData.get('principalType'),
    roleId: formData.get('roleId') ?? '',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.USER_INVITE);

    const invitation = issueInvitation();

    // `inviteEmail` is bound for the whole transaction. It is what permits the user row to be
    // created at all — the INSERT policy admits exactly this address — so a bug that built a
    // row for somebody else is refused by the database rather than by this function.
    const outcome = await inTenantTransaction(
      { tenantId, userId, inviteEmail: input.email },
      async (db) => {
        const existing = await db.appUser.findUnique({
          where: { email: input.email },
          select: { id: true, status: true, passwordHash: true, fullName: true },
        });

        // Somebody who already has an account is added straight away rather than being asked to
        // redeem a second invitation: they control the account already, and a pending invitation
        // they can never usefully accept is a dead state. One human with children at two schools
        // is one user with two memberships.
        const alreadyUsable = Boolean(existing?.passwordHash) && existing?.status === 'ACTIVE';

        const user =
          existing ??
          (await db.appUser.create({
            data: {
              email: input.email,
              fullName: input.fullName,
              status: 'PENDING_INVITE',
              inviteTokenHash: invitation.tokenHash,
              inviteExpiresAt: invitation.expiresAt,
            },
            select: { id: true, status: true, passwordHash: true, fullName: true },
          }));

        // Re-inviting somebody who never redeemed issues a fresh token and discards the old one,
        // which is also how "resend" works. The previous link stops working immediately.
        if (existing && !alreadyUsable) {
          await db.appUser.update({
            where: { id: user.id },
            data: {
              inviteTokenHash: invitation.tokenHash,
              inviteExpiresAt: invitation.expiresAt,
            },
          });
        }

        const duplicate = await db.membership.findFirst({
          where: { userId: user.id, principalType: input.principalType },
          select: { id: true, status: true },
        });

        if (duplicate && duplicate.status !== 'ENDED') {
          throw new RuleViolation(
            `${input.email} is already ${input.principalType.toLowerCase()} at this school.`,
            'email',
          );
        }

        const membership = duplicate
          ? await db.membership.update({
              where: { id: duplicate.id },
              data: {
                status: alreadyUsable ? 'ACTIVE' : 'INVITED',
                invitedAt: new Date(),
                ...(alreadyUsable ? { acceptedAt: new Date() } : {}),
              },
              select: { id: true },
            })
          : await db.membership.create({
              data: {
                // Passed because the type requires it, and overwritten by the scoped client
                // regardless of what is passed — so a wrong value cannot write into another
                // school. The same reasoning as the calendar actions.
                tenantId,
                userId: user.id,
                principalType: input.principalType,
                status: alreadyUsable ? 'ACTIVE' : 'INVITED',
                invitedAt: new Date(),
                ...(alreadyUsable ? { acceptedAt: new Date() } : {}),
              },
              select: { id: true },
            });

        if (input.roleId) {
          // Resolved through the scoped client: a role id belonging to another school is not
          // visible here, so it comes back null rather than being attached.
          const role = await db.role.findFirst({
            where: { id: input.roleId },
            select: { id: true, name: true },
          });
          if (!role) throw new RuleViolation('That role is not available here.', 'roleId');

          await db.membershipRole.create({
            data: { membershipId: membership.id, roleId: role.id },
          });
        }

        await recordAudit(db, {
          tenantId,
          actorUserId: userId,
          actorMembershipId: membershipId,
          action: alreadyUsable ? 'MEMBERSHIP_ADDED' : 'MEMBERSHIP_INVITED',
          resourceType: 'Membership',
          resourceId: membership.id,
          resourceRef: input.email,
          // The address and the hat, never the token. An audit row that carried the token would
          // be a working invitation sitting in a log that more people can read than should.
          after: { email: input.email, principalType: input.principalType },
        });

        return { alreadyUsable };
      },
    );

    revalidatePath(PEOPLE_PATH);

    if (outcome.alreadyUsable) {
      return {
        ok: true,
        message: `${input.email} already has an account and can use this school now.`,
      };
    }

    return {
      ok: true,
      message: `Invitation ready for ${input.email}. The link works once, and expires in 7 days.`,
      invitationLink: invitationUrl(originForLinks(), invitation.token),
    };
  });
}

// =====================================================================================
// Redeeming
// =====================================================================================

/**
 * Sets a password against a valid invitation and activates the memberships it was issued for.
 *
 * <p>Anonymous by necessity: the whole point is that the person has no account yet. Identity
 * comes from the token, which is single-use, expiring, and 256 bits of CSPRNG — so it is the
 * token that is authenticated here, and everything the transaction then does is bounded by what
 * that token's row turns out to be.
 */
export async function redeemInvitationAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = redeemInvitationInput.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const { token, password } = parsed.data;
  const tokenHash = hashInvitationToken(token);

  return run(async () => {
    // Hashed before anything else touches the database, and the raw token is never written
    // anywhere. Binding the hash is what makes the user row visible at all.
    const passwordHash = await bcrypt.hash(password, 12);

    await withRequestContext({ inviteTokenHash: tokenHash }, async (tx) => {
      const user = await tx.appUser.findFirst({
        where: { inviteTokenHash: tokenHash },
        select: { id: true, status: true, inviteExpiresAt: true },
      });

      // One message for "no such token" and "expired" alike. Distinguishing them tells somebody
      // probing links which of their guesses was once real.
      if (!user || isInvitationExpired(user.inviteExpiresAt)) {
        throw new RuleViolation(
          'This invitation link is no longer valid. Ask the school to send a new one.',
        );
      }
      if (user.status === 'DISABLED' || user.status === 'CLOSED') {
        throw new RuleViolation(
          'This invitation link is no longer valid. Ask the school to send a new one.',
        );
      }

      // The identity the token established, bound for the rest of the transaction so the
      // self-update policy applies. It comes from the row just authenticated, never from input.
      await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;

      await tx.appUser.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: 'ACTIVE',
          // Single-use: the token stops working the moment it is spent.
          inviteTokenHash: null,
          inviteExpiresAt: null,
          // NOT set to true. The link may have been passed along by hand rather than emailed,
          // so following it proves possession of the link and nothing about the address.
          // emailVerified stays false until something actually verifies the address.
          sessionsValidFrom: new Date(),
        },
      });

      const invited = await tx.membership.findMany({
        where: { userId: user.id, status: 'INVITED' },
        select: { id: true, tenantId: true },
      });

      for (const membership of invited) {
        // Each membership is activated as its own school. Binding the tenant per row keeps the
        // write inside the same policy every other tenant write obeys, rather than loosening
        // that policy to accommodate this one unauthenticated path.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${membership.tenantId}, true)`;
        await tx.membership.update({
          where: { id: membership.id },
          data: { status: 'ACTIVE', acceptedAt: new Date() },
        });
      }

      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
      await tx.securityEvent.create({
        data: {
          userId: user.id,
          eventType: 'INVITATION_REDEEMED',
          severity: 'INFO',
          detail: { memberships: invited.length },
        },
      });
    });

    return {
      ok: true,
      message: 'Your password is set. You can sign in now.',
    };
  });
}

/**
 * Where invitation links point.
 *
 * <p>From configuration, never from the request's Host header. A link built from a header is a
 * link an attacker can point at their own domain by sending one crafted request, and the
 * resulting email looks entirely genuine to the person who receives it.
 */
function originForLinks(): string {
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error('NEXTAUTH_URL is required to build invitation links');
  return origin;
}
