import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * Row-level security, exercised as a role that cannot bypass it.
 *
 * <p>This suite exists because the obvious check is worthless. `relrowsecurity = true` on every
 * table says only that RLS is switched on; it says nothing about whether any policy binds, and
 * a connection holding BYPASSRLS skips all of them regardless. A project can pass a catalog
 * audit with RLS that enforces precisely nothing — which is what this repository shipped between
 * 20260919092000 and 20260921030000, and said so in IMPLEMENTATION_STATUS.md.
 *
 * <p>So every assertion here runs over a second connection, as `sankofa_app`, which is
 * NOBYPASSRLS. The question asked is always behavioural: what rows come back, and what happens
 * when this school reaches for another school's row. `tenant-isolation.test.ts` asks the same
 * questions of the application-layer client extension; this asks them of the database, with the
 * extension out of the picture entirely.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    'tests/db requires DATABASE_URL to point at a disposable PostgreSQL database. ' +
      'These tests create and delete rows, and grant LOGIN to a role.',
  );
}

const suffix = randomUUID().slice(0, 8);
const slugA = `rls-a-${suffix}`;
const slugB = `rls-b-${suffix}`;

/**
 * The migration creates `sankofa_app` NOLOGIN and without a password, because a password in a
 * migration is a password in git. A connection needs both, so the test grants them here, to a
 * throwaway value, against a database the suite is already allowed to delete rows from.
 */
const restrictedPassword = randomUUID();

let restricted: PrismaClient;
let tenantA: string;
let tenantB: string;
let yearA: string;
let yearB: string;
let userId: string;
let membershipA: string;

function restrictedUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = 'sankofa_app';
  url.password = restrictedPassword;
  return url.toString();
}

/** Runs `fn` in one transaction with the request context bound, the way the application does. */
async function asTenant<T>(
  tenantId: string | null,
  fn: (tx: Omit<PrismaClient, `$${string}`> & { $queryRaw: PrismaClient['$queryRaw'] }) => Promise<T>,
  extra: { userId?: string; signInEmail?: string } = {},
): Promise<T> {
  return restricted.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${extra.userId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.sign_in_email', ${extra.signInEmail ?? ''}, true)`;
    return fn(tx as never);
  });
}

beforeAll(async () => {
  await db.$executeRawUnsafe(
    `ALTER ROLE sankofa_app LOGIN PASSWORD '${restrictedPassword.replace(/'/g, "''")}'`,
  );
  restricted = new PrismaClient({ datasourceUrl: restrictedUrl() });

  const school = (slug: string, name: string) =>
    db.tenant.create({
      data: {
        slug,
        legalName: name,
        displayName: name,
        status: 'ACTIVE',
        countryCode: 'GH',
        defaultCurrency: 'GHS',
      },
    });

  tenantA = (await school(slugA, 'RLS School A')).id;
  tenantB = (await school(slugB, 'RLS School B')).id;

  const dates = { startsOn: new Date('2026-09-07'), endsOn: new Date('2027-07-23') };
  yearA = (
    await db.academicYear.create({
      data: { tenantId: tenantA, code: '2026/2027', name: 'School A 2026/2027', ...dates },
    })
  ).id;
  yearB = (
    await db.academicYear.create({
      data: { tenantId: tenantB, code: '2026/2027', name: 'School B 2026/2027', ...dates },
    })
  ).id;

  const user = await db.appUser.create({
    data: {
      email: `rls-${suffix}@example.test`,
      fullName: 'RLS Test User',
      status: 'ACTIVE',
      passwordHash: '$2a$12$notarealhashnotarealhashnotarealhashnotarealhashnot',
    },
  });
  userId = user.id;

  membershipA = (
    await db.membership.create({
      data: { tenantId: tenantA, userId, principalType: 'STAFF', status: 'ACTIVE' },
    })
  ).id;
  await db.membership.create({
    data: { tenantId: tenantB, userId, principalType: 'STAFF', status: 'ACTIVE' },
  });
});

afterAll(async () => {
  await restricted?.$disconnect();
  // Before the tenants: membership_role references role without ON DELETE CASCADE, so the
  // tenant delete is refused while a join row survives.
  await db.membershipRole.deleteMany({ where: { membership: { tenantId: { in: [tenantA, tenantB] } } } });
  await db.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
  await db.appUser.deleteMany({ where: { email: `rls-${suffix}@example.test` } });
  // Put the role back the way the migration leaves it, so a local database is not left with a
  // login role whose password was printed into a test run.
  await db.$executeRawUnsafe('ALTER ROLE sankofa_app NOLOGIN PASSWORD NULL');
  await db.$disconnect();
});

describe('the role the application connects as', () => {
  it('does not bypass row-level security', async () => {
    const [row] = await db.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sankofa_app'
    `;

    if (!row) {
      throw new Error('The sankofa_app role does not exist — 20260921030000 did not run.');
    }

    // If either of these is ever true, every other assertion in this file passes vacuously.
    expect(row.rolbypassrls).toBe(false);
    expect(row.rolsuper).toBe(false);
  });

  it('leaves no table carrying a tenantId without a policy', async () => {
    // RLS enabled and no policy is a closed table, which is safe but breaks the product. RLS
    // enabled with a policy that never binds is the dangerous one. This catches the first and
    // the behavioural tests below catch the second.
    const gaps = await db.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenantId'
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    `;

    expect(gaps.map((g) => g.relname)).toEqual([]);
  });
});

describe('with no tenant bound', () => {
  it('reads no academic years at all', async () => {
    // The proof that the policies are not inert. A bypassing connection returns every row here.
    const rows = await asTenant(null, (tx) => tx.academicYear.findMany());

    expect(rows).toEqual([]);
  });

  it('reads no users', async () => {
    const rows = await asTenant(null, (tx) => tx.appUser.findMany());

    expect(rows).toEqual([]);
  });

  it('still reads the permission catalogue, which belongs to no school', async () => {
    const count = await asTenant(null, (tx) => tx.permission.count());

    expect(count).toBeGreaterThan(0);
  });
});

describe('bound to one school', () => {
  // Every other assertion in this block is a refusal, and a policy that simply denied
  // everything would satisfy all of them. These two are the control: the school can still do
  // its own work. Without them the suite would pass against a database nobody can use.
  it('can create an academic year of its own and read it back', async () => {
    const created = await asTenant(tenantA, (tx) =>
      // tenantId is named explicitly: this client is deliberately the bare Prisma client, with
      // no tenant-scope extension to inject it. The point is to test the database's rule, not
      // the application's — and here the two agree, because the WITH CHECK passes.
      tx.academicYear.create({
        data: {
          tenantId: tenantA,
          code: 'OWN',
          name: 'A year of its own',
          startsOn: new Date('2028-09-01'),
          endsOn: new Date('2029-07-31'),
        },
      }),
    );

    expect(created.tenantId).toBe(tenantA);

    const readBack = await asTenant(tenantA, (tx) =>
      tx.academicYear.findFirst({ where: { id: created.id } }),
    );
    expect(readBack?.name).toBe('A year of its own');

    await db.academicYear.delete({ where: { id: created.id } });
  });

  it('can write an audit entry for its own actions', async () => {
    const entry = await asTenant(tenantA, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: tenantA,
          actorUserId: userId,
          actorMembershipId: membershipA,
          action: 'ACADEMIC_YEAR_VIEWED',
          resourceType: 'AcademicYear',
        },
      }),
    );

    expect(entry.id).toBeDefined();
    await db.auditLog.deleteMany({ where: { id: entry.id } });
  });

  it('reads its own academic years and not the other school’s', async () => {
    const rows = await asTenant(tenantA, (tx) => tx.academicYear.findMany());

    expect(rows.map((r) => r.id)).toEqual([yearA]);
  });

  it('cannot read the other school’s row even by its exact id', async () => {
    const row = await asTenant(tenantA, (tx) =>
      tx.academicYear.findFirst({ where: { id: yearB } }),
    );

    expect(row).toBeNull();
  });

  it('cannot update the other school’s row', async () => {
    const result = await asTenant(tenantA, (tx) =>
      tx.academicYear.updateMany({ where: { id: yearB }, data: { name: 'hijacked' } }),
    );

    expect(result.count).toBe(0);

    const untouched = await db.academicYear.findUniqueOrThrow({ where: { id: yearB } });
    expect(untouched.name).toBe('School B 2026/2027');
  });

  it('cannot delete the other school’s row', async () => {
    const result = await asTenant(tenantA, (tx) =>
      tx.academicYear.deleteMany({ where: { id: yearB } }),
    );

    expect(result.count).toBe(0);
    expect(await db.academicYear.count({ where: { id: yearB } })).toBe(1);
  });

  it('cannot write a row into the other school by claiming its tenant', async () => {
    // The one an application-layer filter cannot catch: nothing is being read, so there is no
    // WHERE clause to forget. The database refuses it on the WITH CHECK.
    await expect(
      asTenant(tenantA, (tx) =>
        tx.academicYear.create({
          data: {
            tenantId: tenantB,
            code: 'PLANTED',
            name: 'planted',
            startsOn: new Date('2030-01-01'),
            endsOn: new Date('2030-12-31'),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);

    expect(await db.academicYear.count({ where: { name: 'planted' } })).toBe(0);
  });

  it('sees the shared role templates as well as its own roles', async () => {
    const roles = await asTenant(tenantA, (tx) => tx.role.findMany({ where: { tenantId: null } }));

    expect(roles.length).toBeGreaterThan(0);
  });

  it('cannot edit a shared role template that every other school uses', async () => {
    const result = await asTenant(tenantA, (tx) =>
      tx.role.updateMany({ where: { tenantId: null }, data: { name: 'hijacked' } }),
    );

    expect(result.count).toBe(0);
  });
});

describe('the sign-in path, which runs before any school is chosen', () => {
  it('reads exactly the one user being authenticated, and no other', async () => {
    const rows = await asTenant(null, (tx) => tx.appUser.findMany(), {
      signInEmail: `rls-${suffix}@example.test`,
    });

    expect(rows.map((r) => r.id)).toEqual([userId]);
  });

  it('lists the signed-in user’s own memberships across schools', async () => {
    const rows = await asTenant(null, (tx) => tx.membership.findMany(), { userId });

    // Both schools, because choosing between them is the whole point of this query.
    expect(rows.map((r) => r.id).sort()).toEqual(
      (await db.membership.findMany({ where: { userId }, select: { id: true } }))
        .map((r) => r.id)
        .sort(),
    );
  });

  it('does not show one user another user’s memberships', async () => {
    const rows = await asTenant(null, (tx) => tx.membership.findMany(), {
      userId: '00000000-0000-7000-8000-00000000dead',
    });

    expect(rows).toEqual([]);
  });

  it('can record a failed sign-in, which has no tenant and may have no user', async () => {
    // The previous implementation made the security log unwritable in exactly this case: a
    // refused sign-in has nothing bound, which is what the write policy rejected.
    await expect(
      asTenant(null, (tx) =>
        tx.securityEvent.create({
          data: { userId: null, eventType: 'SIGN_IN_FAILED', severity: 'NOTICE' },
        }),
      ),
    ).resolves.toBeDefined();

    await db.securityEvent.deleteMany({ where: { eventType: 'SIGN_IN_FAILED', userId: null } });
  });
});

describe('membership-derived tables', () => {
  it('scopes rows hanging off a membership to the school that membership belongs to', async () => {
    const role = await db.role.create({
      data: { tenantId: tenantA, code: `RLS_${suffix}`, name: 'RLS role' },
    });
    await db.membershipRole.create({ data: { membershipId: membershipA, roleId: role.id } });

    const fromA = await asTenant(tenantA, (tx) => tx.membershipRole.findMany());
    const fromB = await asTenant(tenantB, (tx) => tx.membershipRole.findMany());

    expect(fromA.map((r) => r.membershipId)).toContain(membershipA);
    expect(fromB.map((r) => r.membershipId)).not.toContain(membershipA);
  });
});
