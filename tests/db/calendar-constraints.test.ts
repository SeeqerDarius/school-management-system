import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * The invariants that live in the database rather than in application code.
 *
 * <p>The actions check these first and give a better message, but that is not what guarantees
 * them. A future import script, a console session or a second service all reach the same tables
 * and none of them run the action layer. These tests prove the guarantee is where it is claimed
 * to be — and they fail if the raw-SQL migration was ever dropped from the chain, which a
 * schema-only check would not notice.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

const slug = `constraints-${randomUUID().slice(0, 8)}`;
let tenantId: string;
let yearId: string;

const YEAR = { startsOn: new Date('2026-09-07'), endsOn: new Date('2027-07-23') };

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: {
      slug,
      legalName: 'Constraint Test School',
      displayName: 'Constraint Test School',
      status: 'ACTIVE',
      countryCode: 'GH',
      defaultCurrency: 'GHS',
    },
  });
  tenantId = tenant.id;

  const year = await db.academicYear.create({
    data: { tenantId, code: '2026/2027', name: '2026/2027', ...YEAR },
  });
  yearId = year.id;
});

afterAll(async () => {
  await db.tenant.deleteMany({ where: { slug } });
  await db.$disconnect();
});

describe('academic years', () => {
  it('refuses an end date before the start', async () => {
    await expect(
      db.academicYear.create({
        data: {
          tenantId,
          code: 'BACKWARDS',
          name: 'Backwards',
          startsOn: new Date('2027-07-23'),
          endsOn: new Date('2026-09-07'),
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a year that overlaps another in the same school', async () => {
    await expect(
      db.academicYear.create({
        data: {
          tenantId,
          code: 'OVERLAP',
          name: 'Overlapping',
          startsOn: new Date('2027-07-01'), // inside the existing year
          endsOn: new Date('2028-06-30'),
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a year that meets another exactly on its end date', async () => {
    // The ranges are inclusive of both ends, so 23 July belongs to the existing year and a new
    // one starting that day overlaps it. A half-open range would let this through.
    await expect(
      db.academicYear.create({
        data: {
          tenantId,
          code: 'TOUCHING',
          name: 'Touching',
          startsOn: new Date('2027-07-23'),
          endsOn: new Date('2028-06-30'),
        },
      }),
    ).rejects.toThrow();
  });

  it('allows the next year to start the day after', async () => {
    const next = await db.academicYear.create({
      data: {
        tenantId,
        code: '2027/2028',
        name: '2027/2028',
        startsOn: new Date('2027-07-24'),
        endsOn: new Date('2028-06-30'),
      },
    });

    expect(next.id).toBeTruthy();
    await db.academicYear.delete({ where: { id: next.id } });
  });

  it('refuses a second current year in the same school', async () => {
    await db.academicYear.update({ where: { id: yearId }, data: { isCurrent: true } });

    await expect(
      db.academicYear.create({
        data: {
          tenantId,
          code: 'SECOND_CURRENT',
          name: 'Second current',
          startsOn: new Date('2029-09-03'),
          endsOn: new Date('2030-07-19'),
          isCurrent: true,
        },
      }),
    ).rejects.toThrow();

    await db.academicYear.update({ where: { id: yearId }, data: { isCurrent: false } });
  });

  it('refuses to mark a year closed without recording who closed it', async () => {
    await expect(
      db.academicYear.update({ where: { id: yearId }, data: { status: 'CLOSED' } }),
    ).rejects.toThrow();
  });
});

describe('terms', () => {
  it('refuses two terms that overlap within a year', async () => {
    const first = await db.term.create({
      data: {
        tenantId,
        academicYearId: yearId,
        sequence: 1,
        code: 'T1',
        name: 'First Term',
        startsOn: new Date('2026-09-07'),
        endsOn: new Date('2026-12-18'),
      },
    });

    await expect(
      db.term.create({
        data: {
          tenantId,
          academicYearId: yearId,
          sequence: 2,
          code: 'T2',
          name: 'Second Term',
          startsOn: new Date('2026-12-01'), // inside the first term
          endsOn: new Date('2027-03-26'),
        },
      }),
    ).rejects.toThrow();

    await db.term.delete({ where: { id: first.id } });
  });
});

describe('system roles', () => {
  it('refuses two system roles sharing a code', async () => {
    const existing = await db.role.findFirst({ where: { tenantId: null } });
    expect(existing).not.toBeNull();

    // Without the partial unique index this succeeds, because PostgreSQL treats every NULL
    // tenantId as distinct — and the duplicate is not noticed until a later seed matches the
    // wrong one.
    await expect(
      db.role.create({ data: { code: existing!.code, name: 'Impostor', isSystem: true } }),
    ).rejects.toThrow();
  });
});
