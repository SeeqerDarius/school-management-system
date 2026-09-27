'use server';

import bcrypt from 'bcryptjs';

import { changePasswordInput } from '@/features/account/schema';
import { recordAudit } from '@/server/audit';
import { requireActiveSession } from '@/server/auth/session';
import { withRequestContext } from '@/server/db-context';

/**
 * A person changing their own password.
 *
 * <h2>Why this needs no permission</h2>
 * Every other action in this product is gated on a granular permission code. This one is
 * gated on identity alone, and that is the correct answer rather than a missing check: the
 * resource being changed IS the actor. A permission would have to be granted to everybody to
 * be useful, and a permission granted to everybody is not an authorization control — it is a
 * column that gets switched off one day and locks a school out of its own accounts.
 *
 * <p>What does the work is that the row is resolved from `session.userId`, never from the
 * form. There is no field here naming whose password to change, so there is nothing for a
 * crafted request to point at somebody else. Underneath, the `app_user_self_update` policy
 * admits exactly `id = app.current_user_id()`, so even a bug in this function cannot write
 * another person's hash.
 *
 * <h2>What it deliberately does not do</h2>
 * Attempts here are recorded but NOT rate limited. Reaching this action at all requires a
 * valid session, so an attacker who can call it already holds the account; the marginal prize
 * is lockout of the real owner rather than access. `PASSWORD_CHANGE_REFUSED` makes that
 * visible to anybody reading the security log. Recorded as a gap in IMPLEMENTATION_STATUS.md
 * rather than left to be discovered.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
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

/**
 * A hash to compare against when the account has none.
 *
 * <p>The same trick the sign-in path uses. Here it is not hiding whether an account exists —
 * the caller is already signed in as it — but it keeps the refusal path the same shape and the
 * same cost as the success path, so "you have no password set" is not distinguishable from
 * "your password is wrong" by timing alone.
 */
const ABSENT_PASSWORD = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';

export async function changePasswordAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = changePasswordInput.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
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

  const { currentPassword, newPassword } = parsed.data;

  try {
    const { userId, tenantId, membershipId } = await requireActiveSession();

    // Read, then verify, then write — three steps rather than one transaction, because bcrypt
    // at cost 12 takes roughly 150ms each way and a transaction held open that long is a
    // pooled connection held open that long. Supavisor hands out a finite number of those.
    const before = await withRequestContext({ userId }, (tx) =>
      tx.appUser.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    );

    const storedHash = before?.passwordHash ?? null;
    const matches = await bcrypt.compare(currentPassword, storedHash ?? ABSENT_PASSWORD);

    if (!storedHash || !matches) {
      await recordRefusal(userId, tenantId, storedHash ? 'WRONG_PASSWORD' : 'NO_PASSWORD_SET');
      throw new RuleViolation('That is not your current password.', 'currentPassword');
    }

    // Caught here as well as in the schema. The schema compares the two strings, which misses
    // nothing today, but this compares against what is actually stored — so it still holds if
    // the form ever stops sending the current password in the clear.
    if (await bcrypt.compare(newPassword, storedHash)) {
      throw new RuleViolation(
        'Choose a password different from your current one',
        'newPassword',
      );
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await withRequestContext({ tenantId, userId }, async (tx) => {
      // Conditional on the hash we verified, which makes this a compare-and-swap. Two changes
      // racing cannot both win, and a password changed by somebody else between the read above
      // and this write is refused rather than silently overwritten.
      const changed = await tx.appUser.updateMany({
        where: { id: userId, passwordHash: storedHash },
        data: {
          passwordHash: newHash,
          // Every session issued before now stops working — this one included. That is what
          // changing a password is FOR: if it is being changed because somebody else has it,
          // leaving their session alive defeats the exercise. The screen says so plainly
          // rather than letting the person discover it on their next click.
          sessionsValidFrom: new Date(),
        },
      });

      if (changed.count !== 1) {
        throw new RuleViolation('Your password changed elsewhere. Start again.', 'currentPassword');
      }

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'USER_PASSWORD_CHANGED',
        resourceType: 'AppUser',
        resourceId: userId,
        // No before, no after. The whole value of this record is that it happened and when;
        // a hash in an audit row is a hash in a table more people can read than should.
      });

      await tx.securityEvent.create({
        data: {
          tenantId,
          userId,
          eventType: 'PASSWORD_CHANGED',
          severity: 'NOTICE',
        },
      });
    });

    return {
      ok: true,
      message:
        'Your password is changed. You have been signed out everywhere, including here — ' +
        'sign in again with the new one.',
    };
  } catch (error) {
    if (error instanceof RuleViolation) {
      return {
        ok: false,
        message: error.message,
        ...(error.field ? { fieldErrors: { [error.field]: error.message } } : {}),
      };
    }
    // Never swallowed into a success (invariant I-8). A password change that reports success
    // without changing anything is the worst outcome available here: the person believes the
    // old one is dead and stops treating it as a live credential.
    console.error('change password failed', error);
    return { ok: false, message: 'Something went wrong. Your password was not changed.' };
  }
}

/**
 * Records a refused attempt.
 *
 * <p>Its own transaction, and deliberately not part of the caller's: the refusal has to survive
 * whatever happens next, and an attempt that vanished because the request later threw is an
 * attempt nobody investigating an account takeover will ever see.
 */
async function recordRefusal(userId: string, tenantId: string, reason: string): Promise<void> {
  try {
    await withRequestContext({ tenantId, userId }, (tx) =>
      tx.securityEvent.create({
        data: {
          tenantId,
          userId,
          eventType: 'PASSWORD_CHANGE_REFUSED',
          severity: 'WARNING',
          detail: { reason },
        },
      }),
    );
  } catch (error) {
    // Logged, never rethrown. Failing to record the refusal must not turn a wrong password
    // into a 500 — the person would read that as the product being broken and try again,
    // which is indistinguishable from the attack this line exists to make visible.
    console.error('could not record password change refusal', error);
  }
}
