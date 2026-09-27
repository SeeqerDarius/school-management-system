import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * Who may rewrite a password hash.
 *
 * <p>The change-password action resolves the row from the session and never from the form, so
 * on the application side there is nothing to point at somebody else. This suite asks the
 * question one layer down, where that argument does not apply: if a bug DID aim the update at
 * another person's row, does the database refuse it?
 *
 * <p>Every assertion runs as `sankofa_app`, which is NOBYPASSRLS. Run as the owner these would
 * all pass vacuously, which is the trap `rls-policies.test.ts` documents at length.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    'tests/db requires DATABASE_URL to point at a disposable PostgreSQL database. ' +
      'These tests create and delete rows, and grant LOGIN to a role.',
  );
}

const suffix = randomUUID().slice(0, 8);
const emailOwner = `pw-owner-${suffix}@example.test`;
const emailOther = `pw-other-${suffix}@example.test`;
const slug = `pw-${suffix}`;

const restrictedPassword = randomUUID();

/** Distinguishable on sight, so a failure says which hash won rather than just "not equal". */
const HASH_ORIGINAL = '$2a$12$originaloriginaloriginaloriginaloriginaloriginalor';
const HASH_ATTEMPTED = '$2a$12$attemptedattemptedattemptedattemptedattemptedatte';

let restricted: PrismaClient;
let tenantId: string;
let ownerId: string;
let otherId: string;

function restrictedUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = 'sankofa_app';
  url.password = restrictedPassword;
  return url.toString();
}

/** One transaction with the request context bound, exactly as `db-context.ts` binds it. */
async function asUser<T>(
  userId: string | null,
  fn: (tx: PrismaClient) => Promise<T>,
  tenant: string | null = null,
): Promise<T> {
  return restricted.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.sign_in_email', ${''}, true)`;
    return fn(tx as never);
  });
}

async function storedHash(userId: string): Promise<string | null> {
  const row = await db.appUser.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return row?.passwordHash ?? null;
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
        legalName: 'Password Test School',
        displayName: 'Password Test School',
        status: 'ACTIVE',
        countryCode: 'GH',
        defaultCurrency: 'GHS',
      },
    })
  ).id;

  const make = async (email: string) =>
    (
      await db.appUser.create({
        data: { email, fullName: 'Password Test', status: 'ACTIVE', passwordHash: HASH_ORIGINAL },
      })
    ).id;

  ownerId = await make(emailOwner);
  otherId = await make(emailOther);

  for (const userId of [ownerId, otherId]) {
    await db.membership.create({
      data: { tenantId, userId, principalType: 'STAFF', status: 'ACTIVE' },
    });
  }
});

afterAll(async () => {
  await restricted?.$disconnect();
  await db.membership.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { slug } });
  await db.appUser.deleteMany({ where: { email: { in: [emailOwner, emailOther] } } });
  await db.$executeRawUnsafe('ALTER ROLE sankofa_app NOLOGIN PASSWORD NULL');
  await db.$disconnect();
});

describe('rewriting a password hash', () => {
  it('refuses to change another person s password', async () => {
    const changed = await asUser(ownerId, (tx) =>
      tx.appUser.updateMany({
        where: { id: otherId },
        data: { passwordHash: HASH_ATTEMPTED },
      }),
    );

    // No error is raised: an UPDATE whose USING clause excludes the row simply matches nothing.
    // That is the important shape — the refusal is silent, so code that does not check the
    // count would believe it succeeded. The action checks the count for exactly this reason.
    expect(changed.count).toBe(0);
    expect(await storedHash(otherId)).toBe(HASH_ORIGINAL);
  });

  it('refuses when no user is bound at all', async () => {
    const changed = await asUser(null, (tx) =>
      tx.appUser.updateMany({ where: { id: ownerId }, data: { passwordHash: HASH_ATTEMPTED } }),
    );

    expect(changed.count).toBe(0);
    expect(await storedHash(ownerId)).toBe(HASH_ORIGINAL);
  });

  it('allows a person to change their own', async () => {
    const changed = await asUser(ownerId, (tx) =>
      tx.appUser.updateMany({
        where: { id: ownerId, passwordHash: HASH_ORIGINAL },
        data: { passwordHash: HASH_ATTEMPTED, sessionsValidFrom: new Date() },
      }),
    );

    expect(changed.count).toBe(1);
    expect(await storedHash(ownerId)).toBe(HASH_ATTEMPTED);

    await db.appUser.update({ where: { id: ownerId }, data: { passwordHash: HASH_ORIGINAL } });
  });

  it('matches nothing when the compare-and-swap loses the race', async () => {
    // The guard against two changes racing: the update names the hash it verified, so one that
    // has already moved underneath matches no row rather than overwriting the winner.
    const changed = await asUser(ownerId, (tx) =>
      tx.appUser.updateMany({
        where: { id: ownerId, passwordHash: '$2a$12$staleStaleStaleStaleStaleStaleStaleStaleSt' },
        data: { passwordHash: HASH_ATTEMPTED },
      }),
    );

    expect(changed.count).toBe(0);
    expect(await storedHash(ownerId)).toBe(HASH_ORIGINAL);
  });

  it('shows a person only their own account row', async () => {
    const rows = await asUser(ownerId, (tx) =>
      tx.appUser.findMany({ select: { id: true } }),
    );

    expect(rows.map((r) => r.id)).toEqual([ownerId]);
  });
});
