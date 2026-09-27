import { describe, expect, it } from 'vitest';

import {
  attendanceRate,
  fromSessionDate,
  registerCapabilities,
  schoolToday,
  toSessionDate,
  totalsFor,
} from '@/lib/attendance';
import { P } from '@/lib/permissions';


describe('what may be done to a register', () => {
  const teacher = new Set([P.ATTENDANCE_VIEW, P.ATTENDANCE_MARK, P.STUDENT_VIEW_OWN_CLASS]);
  const admin = new Set([
    P.ATTENDANCE_VIEW,
    P.ATTENDANCE_MARK,
    P.ATTENDANCE_CORRECT,
    P.ATTENDANCE_LOCK,
    P.STUDENT_VIEW,
  ]);

  describe('DRAFT — still being taken', () => {
    it('lets the class teacher mark and submit', () => {
      expect(registerCapabilities('DRAFT', teacher, true)).toEqual({
        mark: true,
        correcting: false,
        submit: true,
        lock: false,
      });
    });

    it('does NOT let a teacher mark a class that is not theirs', () => {
      // Two teachers hold identical permissions. Only one is responsible for this class.
      expect(registerCapabilities('DRAFT', teacher, false).mark).toBe(false);
      expect(registerCapabilities('DRAFT', teacher, false).submit).toBe(false);
    });

    it('does not call a change a correction — nothing has been relied on yet', () => {
      // TESTING.md's register test is "marks a register, corrects one mark". Inside a draft
      // that is not a correction and must not demand a second permission.
      expect(registerCapabilities('DRAFT', teacher, true).correcting).toBe(false);
    });

    it('lets an administrator fill in any draft', () => {
      expect(registerCapabilities('DRAFT', admin, false).mark).toBe(true);
    });

    it('cannot be locked before it is submitted', () => {
      expect(registerCapabilities('DRAFT', admin, true).lock).toBe(false);
    });
  });

  describe('SUBMITTED — finished, and relied upon', () => {
    it('refuses the teacher who took it', () => {
      expect(registerCapabilities('SUBMITTED', teacher, true)).toEqual({
        mark: false,
        correcting: false,
        submit: false,
        lock: false,
      });
    });

    it('lets ATTENDANCE_CORRECT change it, and says that the change is a correction', () => {
      const caps = registerCapabilities('SUBMITTED', admin, false);
      expect(caps.mark).toBe(true);
      expect(caps.correcting).toBe(true);
    });

    it('cannot be submitted twice', () => {
      expect(registerCapabilities('SUBMITTED', admin, true).submit).toBe(false);
    });

    it('may be locked by ATTENDANCE_LOCK', () => {
      expect(registerCapabilities('SUBMITTED', admin, false).lock).toBe(true);
      expect(registerCapabilities('SUBMITTED', teacher, true).lock).toBe(false);
    });
  });

  describe('LOCKED — terminal', () => {
    it('refuses everything, to everybody', () => {
      // I-3 applied to attendance. The database says the same thing with a trigger, so this
      // being wrong is not enough to change a locked register.
      for (const permissions of [teacher, admin]) {
        for (const isClassTeacher of [true, false]) {
          expect(registerCapabilities('LOCKED', permissions, isClassTeacher)).toEqual({
            mark: false,
            correcting: false,
            submit: false,
            lock: false,
          });
        }
      }
    });
  });
});

describe('which day the register is for', () => {
  it('uses the school’s timezone, not the server’s', () => {
    // 23:30 UTC on the 21st is already the 22nd in Auckland and still the 21st in Accra.
    const instant = new Date('2026-09-21T23:30:00.000Z');

    expect(schoolToday('Pacific/Auckland', instant)).toBe('2026-09-22');
    expect(schoolToday('Africa/Accra', instant)).toBe('2026-09-21');
  });

  it('files an early Accra morning under the right day', () => {
    // The failure that would never show up in Ghana: Ghana is UTC+0, so the naive
    // implementation is correct there and wrong everywhere else.
    expect(schoolToday('Africa/Accra', new Date('2026-09-21T07:45:00.000Z'))).toBe('2026-09-21');
  });

  it('falls back to UTC rather than refusing, when a school has a mistyped timezone', () => {
    // Losing the ability to take a register is a worse outcome than a date that is off by
    // hours for one school until somebody fixes the setting.
    expect(schoolToday('Not/AZone', new Date('2026-09-21T10:00:00.000Z'))).toBe('2026-09-21');
  });

  it('round-trips through the stored date without drifting', () => {
    expect(fromSessionDate(toSessionDate('2026-09-21'))).toBe('2026-09-21');
  });
});

describe('counting a register', () => {
  const marks = [
    { status: 'PRESENT' },
    { status: 'PRESENT' },
    { status: 'LATE' },
    { status: 'ABSENT' },
    { status: 'EXCUSED' },
  ];

  it('counts each kind', () => {
    expect(totalsFor(5, marks)).toEqual({
      present: 2,
      absent: 1,
      late: 1,
      excused: 1,
      unmarked: 0,
      roll: 5,
    });
  });

  it('counts a child with no mark as unmarked, never as absent', () => {
    // The distinction this function exists for. "Absent" is a child somebody accounted for;
    // "unmarked" is a child nobody did, which is what a register exists to make visible.
    const totals = totalsFor(8, marks);
    expect(totals.unmarked).toBe(3);
    expect(totals.absent).toBe(1);
  });

  it('never reports negative unmarked when there are more marks than roll', () => {
    expect(totalsFor(2, marks).unmarked).toBe(0);
  });

  it('counts a late child as having attended', () => {
    expect(attendanceRate(totalsFor(5, marks))).toBe(60);
  });

  it('is null for an empty register rather than nought per cent', () => {
    // "No children" and "nobody came" are different facts and must not render the same.
    expect(attendanceRate(totalsFor(0, []))).toBeNull();
    expect(attendanceRate(totalsFor(30, []))).toBeNull();
  });

  it('gives one decimal place', () => {
    expect(attendanceRate(totalsFor(3, [{ status: 'PRESENT' }, { status: 'ABSENT' }, { status: 'ABSENT' }]))).toBe(
      33.3,
    );
  });
});
