import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';
import { forTenant } from '@/server/tenant-scope';

/**
 * Tenant isolation, proved against real PostgreSQL.
 *
 * <p>A tenant-isolation defect is release-blocking, so this suite is not allowed to be
 * reassuring. It runs against an actual database, with actual rows belonging to two different
 * schools, and asks the questions an attacker would: can I read their row if I know its id, can
 * I change it, can I delete it, can I write into their school by claiming to be them.
 *
 * <p>A mock cannot answer any of those. A mock agrees that the filter was applied, which is
 * precisely the thing in doubt.
 */

// No skip when the variable is missing. A suite that quietly excuses itself is a suite that
// stops running and never tells anybody — and this is the one that must never stop running.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'tests/db requires DATABASE_URL to point at a disposable PostgreSQL database. ' +
      'These tests create and delete rows.',
  );
}

const suffix = randomUUID().slice(0, 8);
const slugA = `isolation-a-${suffix}`;
const slugB = `isolation-b-${suffix}`;

let tenantA: string;
let tenantB: string;
let yearA: string;
let yearB: string;

beforeAll(async () => {
  const a = await db.tenant.create({
    data: {
      slug: slugA,
      legalName: 'Isolation Test School A',
      displayName: 'Isolation Test School A',
      status: 'ACTIVE',
      countryCode: 'GH',
      defaultCurrency: 'GHS',
    },
  });
  const b = await db.tenant.create({
    data: {
      slug: slugB,
      legalName: 'Isolation Test School B',
      displayName: 'Isolation Test School B',
      status: 'ACTIVE',
      countryCode: 'GH',
      defaultCurrency: 'GHS',
    },
  });
  tenantA = a.id;
  tenantB = b.id;

  // Identical dates in both schools. Non-overlap is enforced per tenant, so this is legal —
  // and it means the rows are distinguishable only by tenant, which is the point.
  const dates = { startsOn: new Date('2026-09-07'), endsOn: new Date('2027-07-23') };

  const ya = await db.academicYear.create({
    data: { tenantId: tenantA, code: '2026/2027', name: 'School A 2026/2027', ...dates },
  });
  const yb = await db.academicYear.create({
    data: { tenantId: tenantB, code: '2026/2027', name: 'School B 2026/2027', ...dates },
  });
  yearA = ya.id;
  yearB = yb.id;
});

afterAll(async () => {
  // Cascades clear the academic years, terms and roles belonging to these tenants.
  await db.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
  await db.$disconnect();
});

describe('reads', () => {
  it('returns only this school’s academic years', async () => {
    const rows = await forTenant(tenantA).academicYear.findMany();

    expect(rows.map((row) => row.id)).toContain(yearA);
    expect(rows.map((row) => row.id)).not.toContain(yearB);
  });

  it('returns nothing for another school’s id, even when the id is known exactly', async () => {
    const stolen = await forTenant(tenantA).academicYear.findUnique({ where: { id: yearB } });
    expect(stolen).toBeNull();
  });

  it('throws rather than returning another school’s row from findUniqueOrThrow', async () => {
    await expect(
      forTenant(tenantA).academicYear.findUniqueOrThrow({ where: { id: yearB } }),
    ).rejects.toThrow();
  });

  it('does not count another school’s rows', async () => {
    const scoped = await forTenant(tenantA).academicYear.count();
    const belongingToA = await db.academicYear.count({ where: { tenantId: tenantA } });
    const everyone = await db.academicYear.count();

    expect(scoped).toBe(belongingToA);
    // And the database really does hold more than that, so the assertion above is not passing
    // because there is nothing else to see.
    expect(everyone).toBeGreaterThan(belongingToA);
  });

  it('ignores a where clause that tries to name another school', async () => {
    // The injected filter is applied last, so an explicit tenantId in the caller's own where
    // cannot widen it.
    const rows = await forTenant(tenantA).academicYear.findMany({
      where: { tenantId: tenantB },
    });
    expect(rows).toEqual([]);
  });
});

describe('writes', () => {
  it('cannot update another school’s row', async () => {
    const result = await forTenant(tenantA).academicYear.updateMany({
      where: { id: yearB },
      data: { name: 'Renamed by another school' },
    });

    expect(result.count).toBe(0);

    const untouched = await db.academicYear.findUniqueOrThrow({ where: { id: yearB } });
    expect(untouched.name).toBe('School B 2026/2027');
  });

  it('cannot delete another school’s row', async () => {
    const result = await forTenant(tenantA).academicYear.deleteMany({ where: { id: yearB } });
    expect(result.count).toBe(0);

    const stillThere = await db.academicYear.findUnique({ where: { id: yearB } });
    expect(stillThere).not.toBeNull();
  });

  it('writes into this school even when the payload claims another', async () => {
    const created = await forTenant(tenantA).academicYear.create({
      data: {
        tenantId: tenantB, // a lie, or a copy-and-paste mistake
        code: `PLANTED-${suffix}`,
        name: 'Planted',
        startsOn: new Date('2028-09-04'),
        endsOn: new Date('2029-07-20'),
      },
    });

    expect(created.tenantId).toBe(tenantA);
  });
});

describe('shared reference data', () => {
  it('shows the system roles to every school', async () => {
    const systemRoleCount = await db.role.count({ where: { tenantId: null } });
    // Guards against the assertion below passing vacuously on an unseeded database.
    expect(systemRoleCount).toBeGreaterThan(0);

    const visibleToA = await forTenant(tenantA).role.count({ where: { tenantId: null } });
    expect(visibleToA).toBe(systemRoleCount);
  });

  it('keeps one school’s custom role out of another’s list', async () => {
    const custom = await forTenant(tenantA).role.create({
      data: { tenantId: tenantA, code: `CUSTOM_${suffix}`, name: 'A custom role' },
    });

    const seenByA = await forTenant(tenantA).role.findUnique({ where: { id: custom.id } });
    const seenByB = await forTenant(tenantB).role.findUnique({ where: { id: custom.id } });

    expect(seenByA?.id).toBe(custom.id);
    expect(seenByB).toBeNull();
  });

  it('does not let a school edit a shared system role', async () => {
    const systemRole = await db.role.findFirst({ where: { tenantId: null } });
    expect(systemRole).not.toBeNull();

    const result = await forTenant(tenantA).role.updateMany({
      where: { id: systemRole!.id },
      data: { name: 'Renamed from inside a school' },
    });

    expect(result.count).toBe(0);
  });
});

describe('the scope itself', () => {
  it('refuses to build a client with no tenant', () => {
    expect(() => forTenant('')).toThrow(/refusing to build an unscoped client/);
  });
});
