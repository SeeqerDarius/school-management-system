import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashInvitationToken, issueInvitation } from '@/lib/invitation';
import { db } from '@/server/db';

/**
 * The invitation flow, against the policies that actually govern it.
 *
 * <p>`20260921160000_invitation_policies` is what lets an invitation create a user at all, and
 * the whole value of it is that it admits *one* address and no other. That cannot be checked by
 * reading the policy; it has to be exercised as the role the policy names, which is what this
 * suite does — every assertion runs over a second connection as `sankofa_app`, which is
 * NOBYPASSRLS.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

const suffix = randomUUID().slice(0, 8);
const slug = `invite-${suffix}`;
const invitedEmail = `invited-${suffix}@example.test`;
const otherEmail = `other-${suffix}@example.test`;

const restrictedPassword = randomUUID();
let restricted: PrismaClient;
let tenantId: string;

function restrictedUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = 'sankofa_app';
  url.password = restrictedPassword;
  return url.toString();
}

/** One transaction with the request context bound, exactly as the actions bind it. */
async function inContext<T>(
  context: { tenantId?: string; userId?: string; inviteEmail?: string; inviteTokenHash?: string },
  work: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return restricted.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${context.userId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.sign_in_email', ${''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.invite_email', ${context.inviteEmail ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.invite_token_hash', ${context.inviteTokenHash ?? ''}, true)`;
    return work(tx as never);
  });
}

beforeAll(async () => {
  await db.$executeRawUnsafe(
    `ALTER ROLE sankofa_app LOGIN PASSWORD '${restrictedPassword.replace(/'/g, "''")}'`,
  );
  restricted = new PrismaClient({ datasourceUrl: restrictedUrl() });

  tenantId = (
    await db.tenant.create({
      data: {
        slug,
        legalName: 'Invitation Test School',
        displayName: 'Invitation Test School',
        status: 'ACTIVE',
        countryCode: 'GH',
        defaultCurrency: 'GHS',
      },
    })
  ).id;
});

afterAll(async () => {
  await restricted?.$disconnect();
  await db.membershipRole.deleteMany({ where: { membership: { tenantId } } });
  await db.tenant.deleteMany({ where: { slug } });
  await db.appUser.deleteMany({ where: { email: { in: [invitedEmail, otherEmail] } } });
  await db.securityEvent.deleteMany({ where: { eventType: 'INVITATION_REDEEMED' } });
  await db.$executeRawUnsafe('ALTER ROLE sankofa_app NOLOGIN PASSWORD NULL');
  await db.$disconnect();
});

describe('issuing an invitation', () => {
  it('may create exactly the address it declared, and no other', async () => {
    const invitation = issueInvitation();

    const created = await inContext({ tenantId, inviteEmail: invitedEmail }, (tx) =>
      tx.appUser.create({
        data: {
          email: invitedEmail,
          fullName: 'Invited Person',
          status: 'PENDING_INVITE',
          inviteTokenHash: invitation.tokenHash,
          inviteExpiresAt: invitation.expiresAt,
        },
        select: { id: true, passwordHash: true },
      }),
    );

    expect(created.id).toBeTruthy();
    // No password until it is redeemed. An invited account cannot be signed in to.
    expect(created.passwordHash).toBeNull();
  });

  it('refuses to create a different address than the one declared', async () => {
    // The policy's whole job. A bug that built the wrong row — or an action tricked into
    // creating an administrator under an attacker's address — is stopped by the database.
    await expect(
      inContext({ tenantId, inviteEmail: invitedEmail }, (tx) =>
        tx.appUser.create({
          data: { email: otherEmail, fullName: 'Somebody Else', status: 'PENDING_INVITE' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);

    expect(await db.appUser.count({ where: { email: otherEmail } })).toBe(0);
  });

  it('refuses to create any user when no invitation is being issued', async () => {
    await expect(
      inContext({ tenantId }, (tx) =>
        tx.appUser.create({
          data: { email: otherEmail, fullName: 'Somebody Else', status: 'PENDING_INVITE' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('can see whether the address already has an account, and nobody else’s', async () => {
    const seen = await inContext({ tenantId, inviteEmail: invitedEmail }, (tx) =>
      tx.appUser.findMany({ select: { email: true } }),
    );

    expect(seen.map((u) => u.email)).toEqual([invitedEmail]);
  });
});

describe('redeeming', () => {
  it('finds the user by the token hash and nobody else', async () => {
    const invitation = issueInvitation();
    await db.appUser.update({
      where: { email: invitedEmail },
      data: { inviteTokenHash: invitation.tokenHash, inviteExpiresAt: invitation.expiresAt },
    });

    const found = await inContext({ inviteTokenHash: invitation.tokenHash }, (tx) =>
      tx.appUser.findMany({ select: { email: true } }),
    );

    expect(found.map((u) => u.email)).toEqual([invitedEmail]);
  });

  it('shows nothing for a token that was never issued', async () => {
    const found = await inContext({ inviteTokenHash: hashInvitationToken('not-a-real-token') }, (tx) =>
      tx.appUser.findMany({ select: { email: true } }),
    );

    expect(found).toEqual([]);
  });

  it('sets the password and activates the membership, then stops working', async () => {
    const invitation = issueInvitation();
    const user = await db.appUser.update({
      where: { email: invitedEmail },
      data: {
        inviteTokenHash: invitation.tokenHash,
        inviteExpiresAt: invitation.expiresAt,
        status: 'PENDING_INVITE',
        passwordHash: null,
      },
      select: { id: true },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, principalType: 'STAFF', status: 'INVITED' },
      select: { id: true },
    });

    await inContext({ inviteTokenHash: invitation.tokenHash }, async (tx) => {
      const found = await tx.appUser.findFirstOrThrow({
        where: { inviteTokenHash: invitation.tokenHash },
        select: { id: true },
      });

      // The re-bind the action performs: identity established by the token, then used for the
      // rest of the transaction so the self-update policy applies.
      await tx.$executeRaw`SELECT set_config('app.user_id', ${found.id}, true)`;
      await tx.appUser.update({
        where: { id: found.id },
        data: {
          passwordHash: '$2a$12$notarealhashnotarealhashnotarealhashnotarealhashnot',
          status: 'ACTIVE',
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });

      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.membership.update({
        where: { id: membership.id },
        data: { status: 'ACTIVE', acceptedAt: new Date() },
      });
    });

    const after = await db.appUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true, passwordHash: true, inviteTokenHash: true, emailVerified: true },
    });
    expect(after.status).toBe('ACTIVE');
    expect(after.passwordHash).toBeTruthy();
    // Single use: the token is spent.
    expect(after.inviteTokenHash).toBeNull();
    // Deliberately still false. The link may have been handed over rather than emailed, so
    // following it proves possession of the link and nothing about the address.
    expect(after.emailVerified).toBe(false);

    expect(
      (await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).status,
    ).toBe('ACTIVE');

    // Replaying the same link now finds nothing at all.
    const replay = await inContext({ inviteTokenHash: invitation.tokenHash }, (tx) =>
      tx.appUser.findMany({ select: { id: true } }),
    );
    expect(replay).toEqual([]);
  });

  it('cannot reach another school’s membership while redeeming', async () => {
    // A redemption binds each membership's own tenant in turn. Binding one tenant must not
    // make another school's rows writable in the same transaction.
    const otherTenant = await db.tenant.create({
      data: {
        slug: `${slug}-rival`,
        legalName: 'Rival',
        displayName: 'Rival',
        status: 'ACTIVE',
        countryCode: 'GH',
        defaultCurrency: 'GHS',
      },
    });
    const outsider = await db.appUser.create({
      data: { email: otherEmail, fullName: 'Outsider', status: 'ACTIVE' },
    });
    const theirs = await db.membership.create({
      data: {
        tenantId: otherTenant.id,
        userId: outsider.id,
        principalType: 'STAFF',
        status: 'INVITED',
      },
    });

    const result = await inContext({ tenantId }, (tx) =>
      tx.membership.updateMany({ where: { id: theirs.id }, data: { status: 'ACTIVE' } }),
    );

    expect(result.count).toBe(0);
    expect((await db.membership.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe(
      'INVITED',
    );

    await db.membership.deleteMany({ where: { tenantId: otherTenant.id } });
    await db.tenant.delete({ where: { id: otherTenant.id } });
  });
});
