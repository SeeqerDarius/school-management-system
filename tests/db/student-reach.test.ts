import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';
import { studentsInReach } from '@/lib/student-reach';

/**
 * The reach clauses, run against the real schema rather than asserted as objects.
 *
 * <p>`student-reach.test.ts` proves the decision; this proves the clause that decision becomes
 * actually selects those rows and no others. The two failure modes it catches are a relation
 * named wrongly — which Prisma would reject, loudly, only when something ran it — and a clause
 * that is valid but selects more than intended, which nothing rejects at all.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

const suffix = randomUUID().slice(0, 8);
let tenantId = '';
let campusId = '';
let yearId = '';
let termId = '';
let classTeacherMembershipId = '';
let otherTeacherMembershipId = '';
let taughtChildId = '';
let untaughtChildId = '';
let ownChildId = '';
let otherFamilyChildId = '';
let revokedChildId = '';
let guardianId = '';

async function child(reference: string, firstName: string) {
  return db.student.create({
    data: {
      tenantId, campusId, reference, firstName, lastName: 'Test',
      dateOfBirth: new Date('2015-01-01'), gender: 'OTHER',
    },
  });
}

async function teacherMembership(label: string) {
  const user = await db.appUser.create({
    data: { email: `reach-${label}-${suffix}@example.test`, fullName: label, status: 'ACTIVE' },
  });
  return db.membership.create({
    data: { tenantId, userId: user.id, principalType: 'TEACHER', status: 'ACTIVE', startedOn: new Date() },
  });
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: {
      slug: `reach-${suffix}`, legalName: `reach-${suffix}`, displayName: `reach-${suffix}`,
      status: 'ACTIVE', countryCode: 'GH', defaultCurrency: 'GHS',
    },
  });
  tenantId = tenant.id;

  campusId = (await db.campus.create({ data: { tenantId, code: 'MAIN', name: 'Main' } })).id;
  yearId = (await db.academicYear.create({
    data: {
      tenantId, name: '2026/2027', code: `2026-${suffix.slice(0, 4)}`,
      startsOn: new Date('2026-09-07'), endsOn: new Date('2027-07-23'), status: 'ACTIVE',
    },
  })).id;
  termId = (await db.term.create({
    data: {
      tenantId, academicYearId: yearId, name: 'Term 1', code: 'T1', sequence: 1,
      startsOn: new Date('2026-09-07'), endsOn: new Date('2026-12-18'), status: 'ACTIVE',
    },
  })).id;

  classTeacherMembershipId = (await teacherMembership('own')).id;
  otherTeacherMembershipId = (await teacherMembership('other')).id;

  const myClass = await db.classGroup.create({
    data: { tenantId, academicYearId: yearId, campusId, code: 'B5A', name: 'Basic 5 A', classTeacherMembershipId },
  });
  const theirClass = await db.classGroup.create({
    data: {
      tenantId, academicYearId: yearId, campusId, code: 'B5B', name: 'Basic 5 B',
      classTeacherMembershipId: otherTeacherMembershipId,
    },
  });

  taughtChildId = (await child(`STU-T-${suffix}`, 'Taught')).id;
  untaughtChildId = (await child(`STU-U-${suffix}`, 'Untaught')).id;
  ownChildId = (await child(`STU-O-${suffix}`, 'Own')).id;
  otherFamilyChildId = (await child(`STU-F-${suffix}`, 'OtherFamily')).id;
  revokedChildId = (await child(`STU-R-${suffix}`, 'Revoked')).id;

  await db.enrolment.create({
    data: { tenantId, studentId: taughtChildId, academicYearId: yearId, termId, campusId, classId: myClass.id, enrolmentDate: new Date('2026-09-07') },
  });
  await db.enrolment.create({
    data: { tenantId, studentId: untaughtChildId, academicYearId: yearId, termId, campusId, classId: theirClass.id, enrolmentDate: new Date('2026-09-07') },
  });

  guardianId = (await db.guardian.create({
    data: { tenantId, firstName: 'Akosua', lastName: 'Quaye', phoneE164: `+2332000${suffix.slice(0, 4)}` },
  })).id;

  await db.guardianRelationship.create({
    data: { tenantId, studentId: ownChildId, guardianId, relationshipType: 'MOTHER' },
  });
  await db.guardianRelationship.create({
    data: {
      tenantId, studentId: revokedChildId, guardianId, relationshipType: 'MOTHER',
      revokedAt: new Date(), revokedReason: 'Court order 2026/114 removed parental access.',
    },
  });
});

afterAll(async () => {
  if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.appUser.deleteMany({ where: { email: { contains: `reach-` } } });
  await db.$disconnect();
});

const found = async (where: Record<string, unknown>) =>
  (await db.student.findMany({ where: { tenantId, ...where }, select: { id: true } })).map((s) => s.id).sort();

describe('the reach clauses select what they claim', () => {
  it('ALL_STUDENTS selects every child in the school', async () => {
    const ids = await found(studentsInReach({ kind: 'ALL_STUDENTS' }));
    expect(ids).toHaveLength(5);
  });

  it('NONE selects nobody, against real rows', async () => {
    // The clause most worth proving: an omitted filter here returns the whole school, so
    // "nobody" being written as an impossible id is the thing standing between the two.
    expect(await found(studentsInReach({ kind: 'NONE' }))).toEqual([]);
  });

  it('OWN_CLASSES selects the class teacher’s children and nobody else’s', async () => {
    const ids = await found(studentsInReach({ kind: 'OWN_CLASSES', membershipId: classTeacherMembershipId }));
    expect(ids).toEqual([taughtChildId]);
    expect(ids).not.toContain(untaughtChildId);
  });

  it('OWN_CLASSES gives the other teacher a different child from the same query', async () => {
    // Two teachers, identical permissions, different answers. That is the whole point.
    expect(await found(studentsInReach({ kind: 'OWN_CLASSES', membershipId: otherTeacherMembershipId })))
      .toEqual([untaughtChildId]);
  });

  it('OWN_CLASSES gives a teacher who is class teacher of nothing an empty list', async () => {
    const spare = await teacherMembership(`spare-${randomUUID().slice(0, 4)}`);
    expect(await found(studentsInReach({ kind: 'OWN_CLASSES', membershipId: spare.id }))).toEqual([]);
  });

  it('OWN_CHILDREN selects the guardian’s own child', async () => {
    const ids = await found(studentsInReach({ kind: 'OWN_CHILDREN', guardianId }));
    expect(ids).toContain(ownChildId);
  });

  it('OWN_CHILDREN excludes a child whose link was revoked', async () => {
    // The revocation column earning its keep: the row survives for the safeguarding record
    // and the child leaves the parent's list in the same instant.
    const ids = await found(studentsInReach({ kind: 'OWN_CHILDREN', guardianId }));
    expect(ids).not.toContain(revokedChildId);
    expect(ids).toEqual([ownChildId]);
  });

  it('OWN_CHILDREN excludes another family’s child', async () => {
    const ids = await found(studentsInReach({ kind: 'OWN_CHILDREN', guardianId }));
    expect(ids).not.toContain(otherFamilyChildId);
  });
});
