import { P } from '@/lib/permissions';

/**
 * Which day a register is for, what may be done to one, and how to count it.
 *
 * <p>No database access and no framework here, so every rule below is directly testable.
 *
 * <p>Reach — which classes and children a person may touch at all — deliberately does NOT live
 * here. It lives in `student-reach.ts`, and there is exactly one definition of it: two answers
 * to "which children are mine" would eventually disagree, and on this particular question
 * disagreeing means a teacher seeing another class's children.
 */

// =====================================================================================
// Which day it is
// =====================================================================================

/**
 * Today, in the school's timezone.
 *
 * <p>Not `new Date().toISOString().slice(0, 10)`. A register is a calendar fact about a school
 * day, and the server is not in the school. A teacher in Accra taking the register at 08:00 on
 * Tuesday must not have it filed under Monday because the function ran in a datacentre that had
 * not reached Tuesday yet — and at the other end of the day, a school in Auckland would file
 * Tuesday's register under Monday for its entire morning.
 *
 * <p>Ghana sits at UTC+0 all year, so this is a no-op there and would never have been caught by
 * testing against the first market. That is exactly why it is here: §136 says Ghana is the first
 * configuration, not the only one.
 */
export function schoolToday(timezone: string, now: Date = new Date()): string {
  return schoolDate(now, timezone);
}

/** Formats an instant as a `YYYY-MM-DD` calendar date in the given timezone. */
export function schoolDate(instant: Date, timezone: string): string {
  // `en-CA` renders ISO-ordered dates, which saves reassembling parts by hand. An unknown
  // timezone would throw, and a school with a mistyped timezone should not lose the ability to
  // take a register, so it falls back to UTC.
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** A `YYYY-MM-DD` string as the UTC midnight PostgreSQL stores a `date` as. */
export function toSessionDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** The stored `date` back as `YYYY-MM-DD`, without a timezone conversion applied twice. */
export function fromSessionDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// =====================================================================================
// What may be done to one register
// =====================================================================================

export type RegisterStatusName = 'DRAFT' | 'SUBMITTED' | 'LOCKED';

export interface RegisterCapabilities {
  /** May change a mark. */
  mark: boolean;
  /** Changing a mark now is a correction: it needs a reason, and it is audited as one. */
  correcting: boolean;
  /** May move DRAFT → SUBMITTED. */
  submit: boolean;
  /** May move SUBMITTED → LOCKED. */
  lock: boolean;
}

const NOTHING: RegisterCapabilities = {
  mark: false,
  correcting: false,
  submit: false,
  lock: false,
};

/**
 * What this person may do to this register.
 *
 * <p>The three states map onto the three permissions the catalogue already carries, and the
 * mapping is the design rather than a convention:
 *
 * <ul>
 *   <li><b>DRAFT</b> — being taken. The class teacher changes marks freely with
 *       `ATTENDANCE_MARK`; changing your own mind before you have finished is not a
 *       correction, which is why the test in `TESTING.md` ("marks a register, corrects one
 *       mark") needs no second permission.</li>
 *   <li><b>SUBMITTED</b> — finished. A change is now a correction to a record somebody has
 *       relied on, so it needs `ATTENDANCE_CORRECT` and a recorded reason. A teacher does not
 *       hold that permission; an administrator does.</li>
 *   <li><b>LOCKED</b> — nothing, for anybody, ever. A database trigger says the same thing, so
 *       this function being wrong is not enough to change a locked register.</li>
 * </ul>
 *
 * <p>`isClassTeacher` is not a permission and is not interchangeable with one: two teachers hold
 * identical permissions, and only one of them is responsible for this class.
 */
export function registerCapabilities(
  status: RegisterStatusName,
  permissions: ReadonlySet<string>,
  isClassTeacher: boolean,
): RegisterCapabilities {
  if (status === 'LOCKED') return NOTHING;

  const mayCorrect = permissions.has(P.ATTENDANCE_CORRECT);

  if (status === 'SUBMITTED') {
    return {
      mark: mayCorrect,
      correcting: mayCorrect,
      submit: false,
      lock: permissions.has(P.ATTENDANCE_LOCK),
    };
  }

  // DRAFT. The person taking it is the class teacher; an administrator who can correct a
  // submitted register can obviously also fill in a draft one.
  const mayMark = (permissions.has(P.ATTENDANCE_MARK) && isClassTeacher) || mayCorrect;

  return { mark: mayMark, correcting: false, submit: mayMark, lock: false };
}

// =====================================================================================
// Summarising a register
// =====================================================================================

export interface AttendanceTotals {
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Children on the roll for that day who have no mark at all. */
  unmarked: number;
  roll: number;
}

/**
 * Counts a register.
 *
 * <p>`unmarked` is counted rather than folded into "absent", and the distinction is the point of
 * this function. A child with no mark is not a child who was recorded as away — it is a child
 * nobody accounted for, which is the state a register exists to make visible. Collapsing the two
 * would make an unfinished register look complete.
 */
export function totalsFor(
  rollSize: number,
  marks: ReadonlyArray<{ status: string }>,
): AttendanceTotals {
  const totals: AttendanceTotals = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    unmarked: 0,
    roll: rollSize,
  };

  for (const mark of marks) {
    if (mark.status === 'PRESENT') totals.present += 1;
    else if (mark.status === 'ABSENT') totals.absent += 1;
    else if (mark.status === 'LATE') totals.late += 1;
    else if (mark.status === 'EXCUSED') totals.excused += 1;
  }

  totals.unmarked = Math.max(0, rollSize - (totals.present + totals.absent + totals.late + totals.excused));
  return totals;
}

/**
 * The proportion present, as a percentage to one decimal place, or null when nobody is on the
 * roll.
 *
 * <p>A late child was in school, so they count towards attendance; an excused absence does not.
 * That is the convention a statutory return uses, and returning `null` for an empty roll rather
 * than 0 % keeps "no children" from being reported as "nobody came".
 */
export function attendanceRate(totals: AttendanceTotals): number | null {
  const marked = totals.present + totals.absent + totals.late + totals.excused;
  if (marked === 0) return null;
  return Math.round(((totals.present + totals.late) / marked) * 1000) / 10;
}
