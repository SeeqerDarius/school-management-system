import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * What the database refuses about class groups and revoked guardian links.
 *
 * <p>`enrolment.classId` existed before this as a nullable uuid with nothing behind it, and
 * `guardian_relationship` had no way to say that access had been withdrawn. Both are rules the
 * action layer could hold and neither should only be held there: an import script, a console
 * session and a support query all reach these tables and none of them run a Server Action.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

const suffix = randomUUID().slice(0, 8);
let tenantId = '';
let otherTenantId = '';
let campusId = '';
let otherCampusId = '';
let yearId = '';
let otherYearId = '';
let staffMembershipId = '';
let guardianMembershipId = '';
let termId = '';
let studentId = '';

async function makeTenant(slug: string) {
  const tenant = await db.tenant.create({
    data: { slug, legalName: slug, displayName: slug, status: 'ACTIVE', countryCode: 'GH', defaultCurrency: 'GHS' },
  });
  const campus = await db.campus.create({
    data: { tenantId: tenant.id, code: 'MAIN', name: `${slug} Main` },
  });
  const year = await db.academicYear.create({
    data: {
      tenantId: tenant.id,
      name: '2026/2027',
      code: `2026-${slug.slice(-4)}`,
      startsOn: new Date('2026-09-07'),
      endsOn: new Date('2027-07-23'),
      status: 'ACTIVE',
    },
  });
  return { tenantId: tenant.id, campusId: campus.id, yearId: year.id };
}

beforeAll(async () => {
  const a = await makeTenant(`cg-a-${suffix}`);
  const b = await makeTenant(`cg-b-${suffix}`);
  tenantId = a.tenantId; campusId = a.campusId; yearId = a.yearId;
  otherTenantId = b.tenantId; otherCampusId = b.campusId; otherYearId = b.yearId;

  const user = await db.appUser.create({
    data: { email: `cg-${suffix}@example.test`, fullName: 'Kofi Tetteh', status: 'ACTIVE' },
  });
  const staff = await db.membership.create({
    data: { tenantId, userId: user.id, principalType: 'TEACHER', status: 'ACTIVE', startedOn: new Date() },
  });
  staffMembershipId = staff.id;

  const parentUser = await db.appUser.create({
    data: { email: `cg-parent-${suffix}@example.test`, fullName: 'Akosua Quaye', status: 'ACTIVE' },
  });
  const parent = await db.membership.create({
    data: { tenantId, userId: parentUser.id, principalType: 'GUARDIAN', status: 'ACTIVE', startedOn: new Date() },
  });
  guardianMembershipId = parent.id;

  const term = await db.term.create({
    data: {
      tenantId,
      academicYearId: yearId,
      name: 'Term 1',
      code: 'T1',
      sequence: 1,
      startsOn: new Date('2026-09-07'),
      endsOn: new Date('2026-12-18'),
      status: 'ACTIVE',
    },
  });
  termId = term.id;

  const student = await db.student.create({
    data: {
      tenantId, campusId, reference: `STU-${suffix}`, firstName: 'Kojo', lastName: 'Quaye',
      dateOfBirth: new Date('2015-06-14'), gender: 'MALE',
    },
  });
  studentId = student.id;

});

afterAll(async () => {
  if (tenantId) await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await db.appUser.deleteMany({ where: { email: { contains: `cg-${suffix}` } } });
  await db.appUser.deleteMany({ where: { email: { contains: `cg-parent-${suffix}` } } });
  await db.$disconnect();
});

const aClass = (over: Record<string, unknown> = {}) => ({
  tenantId, academicYearId: yearId, campusId, code: `B5${randomUUID().slice(0, 4)}`, name: 'Basic 5 A',
  ...over,
});

describe('who may be a class teacher', () => {
  it('accepts a member of teaching staff', async () => {
    const created = await db.classGroup.create({
      data: aClass({ classTeacherMembershipId: staffMembershipId }),
    });
    expect(created.classTeacherMembershipId).toBe(staffMembershipId);
  });

  it('accepts a class with nobody assigned yet', async () => {
    // A class is created before the timetable is settled. "Not yet decided" is a real state
    // and must not be forced into naming the wrong person.
    const created = await db.classGroup.create({ data: aClass() });
    expect(created.classTeacherMembershipId).toBeNull();
  });

  it('refuses a guardian, however the row is written', async () => {
    // The foreign key cannot express this: principalType lives on the referenced row and no
    // foreign key constrains a column it does not name. A parent with a register to mark
    // would see every child in the class.
    await expect(
      db.classGroup.create({ data: aClass({ classTeacherMembershipId: guardianMembershipId }) }),
    ).rejects.toThrow(/cannot be a class teacher/i);
  });

  it('refuses a guardian on update as well as on insert', async () => {
    const created = await db.classGroup.create({ data: aClass() });
    await expect(
      db.classGroup.update({
        where: { id: created.id },
        data: { classTeacherMembershipId: guardianMembershipId },
      }),
    ).rejects.toThrow(/cannot be a class teacher/i);
  });
});

describe('a class belongs to one school', () => {
  it('refuses a class teacher from another school', async () => {
    const otherUser = await db.appUser.create({
      data: { email: `cg-other-${suffix}@example.test`, fullName: 'Other Staff', status: 'ACTIVE' },
    });
    const otherStaff = await db.membership.create({
      data: { tenantId: otherTenantId, userId: otherUser.id, principalType: 'TEACHER', status: 'ACTIVE', startedOn: new Date() },
    });

    // The composite key is what catches this. A tenant policy checks the row being written,
    // not the rows it points at, and a foreign-key check is a system operation RLS is not
    // applied to at all — so without tenantId in the reference this row would be accepted.
    await expect(
      db.classGroup.create({ data: aClass({ classTeacherMembershipId: otherStaff.id }) }),
    ).rejects.toThrow();
  });

  it('refuses an academic year from another school', async () => {
    await expect(
      db.classGroup.create({ data: aClass({ academicYearId: otherYearId }) }),
    ).rejects.toThrow();
  });

  it('refuses a campus from another school', async () => {
    await expect(
      db.classGroup.create({ data: aClass({ campusId: otherCampusId }) }),
    ).rejects.toThrow();
  });
});

describe('an enrolment and its class agree about the year', () => {
  it('accepts an enrolment into a class of the same year', async () => {
    const group = await db.classGroup.create({ data: aClass() });
    const created = await db.enrolment.create({
      data: {
        tenantId, studentId, academicYearId: yearId, termId, campusId,
        classId: group.id, enrolmentDate: new Date('2026-09-07'),
      },
    });
    expect(created.classId).toBe(group.id);
  });

  it('refuses an enrolment into a class belonging to a different year', async () => {
    // Both rows are individually valid and only the pair is wrong, which is exactly the shape
    // of error no single-table constraint catches.
    const secondYear = await db.academicYear.create({
      data: {
        tenantId, name: '2027/2028', code: `2027-${suffix.slice(0, 4)}`,
        startsOn: new Date('2027-09-06'), endsOn: new Date('2028-07-21'), status: 'PLANNED',
      },
    });
    const nextYearClass = await db.classGroup.create({
      data: aClass({ academicYearId: secondYear.id }),
    });
    const otherStudent = await db.student.create({
      data: {
        tenantId, campusId, reference: `STU-B-${suffix}`, firstName: 'Ama', lastName: 'Mensah',
        dateOfBirth: new Date('2015-04-01'), gender: 'FEMALE',
      },
    });

    await expect(
      db.enrolment.create({
        data: {
          tenantId, studentId: otherStudent.id, academicYearId: yearId, termId, campusId,
          classId: nextYearClass.id, enrolmentDate: new Date('2026-09-07'),
        },
      }),
    ).rejects.toThrow(/not a class of this enrolment/i);
  });
});

describe('revoking a guardian link', () => {
  async function freshLink() {
    const g = await db.guardian.create({
      data: { tenantId, firstName: 'Yaa', lastName: 'Nartey', phoneE164: `+2332000${randomUUID().slice(0, 5)}` },
    });
    const s = await db.student.create({
      data: {
        tenantId, campusId, reference: `STU-R-${randomUUID().slice(0, 6)}`, firstName: 'Esi', lastName: 'Boateng',
        dateOfBirth: new Date('2015-02-23'), gender: 'FEMALE',
      },
    });
    return db.guardianRelationship.create({
      data: { tenantId, studentId: s.id, guardianId: g.id, relationshipType: 'MOTHER' },
    });
  }

  it('refuses a revocation with no reason at all', async () => {
    // The bug this is written against: a CHECK rejects a row only when it evaluates to FALSE,
    // and `length(btrim(NULL)) >= 8` is NULL. Without the explicit IS NOT NULL a reasonless
    // revocation goes straight in, and the safeguarding record silently loses why.
    const link = await freshLink();
    await expect(
      db.guardianRelationship.update({ where: { id: link.id }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow(/revocation_is_reasoned/i);
  });

  it('refuses a reason that says nothing', async () => {
    const link = await freshLink();
    await expect(
      db.guardianRelationship.update({
        where: { id: link.id },
        data: { revokedAt: new Date(), revokedReason: '  n/a  ' },
      }),
    ).rejects.toThrow(/revocation_is_reasoned/i);
  });

  it('accepts a revocation that states why', async () => {
    const link = await freshLink();
    const revoked = await db.guardianRelationship.update({
      where: { id: link.id },
      data: { revokedAt: new Date(), revokedReason: 'Court order 2026/114 removed parental access.' },
    });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('leaves a live link alone — the constraint only bites on revocation', async () => {
    const link = await freshLink();
    const updated = await db.guardianRelationship.update({
      where: { id: link.id },
      data: { isPrimary: true },
    });
    expect(updated.isPrimary).toBe(true);
    expect(updated.revokedAt).toBeNull();
  });

  it('keeps the row rather than deleting it, so who had access and when survives', async () => {
    const link = await freshLink();
    await db.guardianRelationship.update({
      where: { id: link.id },
      data: { revokedAt: new Date(), revokedReason: 'Care order; access withdrawn pending review.' },
    });
    const still = await db.guardianRelationship.findUnique({ where: { id: link.id } });
    expect(still).not.toBeNull();
    expect(still?.revokedReason).toMatch(/Care order/);
  });
});
