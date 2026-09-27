import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/server/db';

/**
 * What the database refuses about a register.
 *
 * <p>A register is evidence. It is read back by a statutory return, by a safeguarding review
 * and, when a child comes to harm, by somebody asking who knew they were not in school. Rules
 * that live only in a Server Action are rules an import script, a console session or a support
 * query walks straight past, so the two that matter most are triggers — and these are the tests
 * that prove it, by going round the action layer exactly as those callers would.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tests/db requires DATABASE_URL to point at a disposable PostgreSQL database.');
}

const suffix = randomUUID().slice(0, 8);
let tenantId = '';
let campusId = '';
let yearId = '';
let termId = '';
let classGroupId = '';
let childA = '';
let childB = '';

const TERM_START = new Date('2025-09-08');
const TERM_END = new Date('2025-12-19');
const A_SCHOOL_DAY = new Date('2025-09-15');

async function enrol(studentId: string) {
  return db.enrolment.create({
    data: { tenantId, studentId, academicYearId: yearId, termId, campusId, classId: classGroupId, enrolmentDate: TERM_START, status: 'ACTIVE' },
  });
}

async function register(over: Record<string, unknown> = {}) {
  return db.attendanceRegister.create({
    data: { tenantId, classGroupId, termId, sessionDate: A_SCHOOL_DAY, ...over },
  });
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: {
      slug: `att-${suffix}`, legalName: `att-${suffix}`, displayName: `att-${suffix}`,
      status: 'ACTIVE', countryCode: 'GH', defaultCurrency: 'GHS',
    },
  });
  tenantId = tenant.id;
  campusId = (await db.campus.create({ data: { tenantId, code: 'MAIN', name: 'Main' } })).id;
  yearId = (await db.academicYear.create({
    data: { tenantId, name: '2025/2026', code: `2025-${suffix.slice(0, 4)}`, startsOn: TERM_START, endsOn: new Date('2026-07-24'), status: 'ACTIVE' },
  })).id;
  termId = (await db.term.create({
    data: { tenantId, academicYearId: yearId, name: 'Term 1', code: 'T1', sequence: 1, startsOn: TERM_START, endsOn: TERM_END, status: 'ACTIVE' },
  })).id;
  classGroupId = (await db.classGroup.create({
    data: { tenantId, academicYearId: yearId, campusId, code: 'B5A', name: 'Basic 5 A' },
  })).id;

  childA = (await db.student.create({
    data: { tenantId, campusId, reference: `STU-A-${suffix}`, firstName: 'Ama', lastName: 'Mensah', dateOfBirth: new Date('2015-04-01'), gender: 'FEMALE' },
  })).id;
  childB = (await db.student.create({
    data: { tenantId, campusId, reference: `STU-B-${suffix}`, firstName: 'Kojo', lastName: 'Quaye', dateOfBirth: new Date('2015-06-14'), gender: 'MALE' },
  })).id;

  await enrol(childA);
  await enrol(childB);
});

afterAll(async () => {
  // The transition trigger refuses to delete a locked register, which would otherwise block
  // the cascade from tenant. Disabled for teardown only, and re-enabled immediately.
  await db.$executeRawUnsafe('ALTER TABLE "attendance_register" DISABLE TRIGGER attendance_register_transition');
  await db.$executeRawUnsafe('ALTER TABLE "attendance_entry" DISABLE TRIGGER attendance_entry_register_open');
  try {
    if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } });
  } finally {
    await db.$executeRawUnsafe('ALTER TABLE "attendance_register" ENABLE TRIGGER attendance_register_transition');
    await db.$executeRawUnsafe('ALTER TABLE "attendance_entry" ENABLE TRIGGER attendance_entry_register_open');
    await db.$disconnect();
  }
});

describe('which day a register can be for', () => {
  it('refuses a day that has not happened', async () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    await expect(register({ sessionDate: nextYear })).rejects.toThrow();
  });

  it('refuses a day outside the term it names', async () => {
    await expect(register({ sessionDate: new Date('2025-08-01') })).rejects.toThrow(/outside the term/i);
  });

  it('accepts a day inside the term', async () => {
    const r = await register({ sessionDate: new Date('2025-09-22') });
    expect(r.status).toBe('DRAFT');
  });

  it('allows only one register per class per day', async () => {
    const day = new Date('2025-09-29');
    await register({ sessionDate: day });
    await expect(register({ sessionDate: day })).rejects.toThrow();
  });
});

describe('a register cannot be submitted while a child is unaccounted for', () => {
  it('refuses submission with nobody marked', async () => {
    // Invariant I-9. Two children are enrolled; neither has an entry.
    const r = await register({ sessionDate: new Date('2025-10-06') });
    await expect(
      db.attendanceRegister.update({
        where: { id: r.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      }),
    ).rejects.toThrow(/have no mark/i);
  });

  it('refuses submission with one child still unmarked, and says how many', async () => {
    const r = await register({ sessionDate: new Date('2025-10-13') });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT' } });

    await expect(
      db.attendanceRegister.update({
        where: { id: r.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      }),
    ).rejects.toThrow(/1 child\(ren\) on the roll have no mark/i);
  });

  it('accepts submission once every child is accounted for', async () => {
    const r = await register({ sessionDate: new Date('2025-10-20') });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT' } });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childB, status: 'ABSENT' } });

    const submitted = await db.attendanceRegister.update({
      where: { id: r.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    expect(submitted.status).toBe('SUBMITTED');
  });

  it('counts an absent child as accounted for — absence is a mark, not a missing row', async () => {
    const r = await register({ sessionDate: new Date('2025-10-27') });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'ABSENT' } });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childB, status: 'EXCUSED', reason: 'Medical appointment' } });
    await expect(
      db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } }),
    ).resolves.toBeTruthy();
  });
});

describe('LOCKED is final, for everybody', () => {
  async function lockedRegister(day: string) {
    const r = await register({ sessionDate: new Date(day) });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT' } });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childB, status: 'PRESENT' } });
    await db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    return db.attendanceRegister.update({
      where: { id: r.id },
      data: { status: 'LOCKED', lockedAt: new Date(), lockedReason: 'Statutory return for the autumn term.' },
    });
  }

  it('refuses any update to a locked register', async () => {
    // I-3 applied to attendance. This runs as the migration owner — the most privileged caller
    // there is — so it is not the application layer being polite.
    const r = await lockedRegister('2025-11-03');
    await expect(
      db.attendanceRegister.update({ where: { id: r.id }, data: { lockedReason: 'Something else entirely.' } }),
    ).rejects.toThrow(/locked register cannot be changed/i);
  });

  it('refuses unlocking it', async () => {
    const r = await lockedRegister('2025-11-10');
    await expect(
      db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'SUBMITTED', lockedAt: null, lockedReason: null } }),
    ).rejects.toThrow(/locked register cannot be changed/i);
  });

  it('refuses deleting it', async () => {
    const r = await lockedRegister('2025-11-17');
    await expect(db.attendanceRegister.delete({ where: { id: r.id } })).rejects.toThrow(/cannot be deleted/i);
  });

  it('refuses marking against it', async () => {
    const r = await lockedRegister('2025-11-24');
    await expect(
      db.attendanceEntry.updateMany({ where: { registerId: r.id }, data: { status: 'ABSENT' } }),
    ).rejects.toThrow(/locked register cannot be marked/i);
  });

  it('demands a stated reason before it can be locked at all', async () => {
    const r = await register({ sessionDate: new Date('2025-12-01') });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT' } });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childB, status: 'PRESENT' } });
    await db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });

    await expect(
      db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'LOCKED', lockedAt: new Date() } }),
    ).rejects.toThrow(/status_coherent/i);
  });
});

describe('a submitted register is not reopened', () => {
  it('refuses SUBMITTED going back to DRAFT', async () => {
    const r = await register({ sessionDate: new Date('2025-12-08') });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT' } });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childB, status: 'PRESENT' } });
    await db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });

    await expect(
      db.attendanceRegister.update({ where: { id: r.id }, data: { status: 'DRAFT', submittedAt: null } }),
    ).rejects.toThrow(/cannot be reopened/i);
  });
});

describe('what a mark must say', () => {
  it('refuses an excused absence with no reason', async () => {
    const r = await register({ sessionDate: new Date('2025-12-15') });
    await expect(
      db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'EXCUSED' } }),
    ).rejects.toThrow(/excused_is_reasoned/i);
  });

  it('refuses a lateness on a child who was not late', async () => {
    const r = await register({ sessionDate: new Date('2025-12-16') });
    await expect(
      db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT', minutesLate: 12 } }),
    ).rejects.toThrow(/lateness_belongs_to_late/i);
  });

  it('accepts a lateness on a child who was', async () => {
    const r = await register({ sessionDate: new Date('2025-12-17') });
    const entry = await db.attendanceEntry.create({
      data: { tenantId, registerId: r.id, studentId: childA, status: 'LATE', minutesLate: 12 },
    });
    expect(entry.minutesLate).toBe(12);
  });

  it('marks a child at most once per register', async () => {
    const r = await register({ sessionDate: new Date('2025-12-18') });
    await db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'PRESENT' } });
    await expect(
      db.attendanceEntry.create({ data: { tenantId, registerId: r.id, studentId: childA, status: 'ABSENT' } }),
    ).rejects.toThrow();
  });
});
