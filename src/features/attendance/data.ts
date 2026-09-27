import 'server-only';

import { classesInReach, rollForTerm } from '@/features/classes/data';
import type { AttendanceStatusName } from '@/features/attendance/schema';
import {
  attendanceRate,
  fromSessionDate,
  registerCapabilities,
  schoolToday,
  toSessionDate,
  totalsFor,
  type RegisterStatusName,
} from '@/lib/attendance';
import { P } from '@/lib/permissions';
import { studentReach } from '@/lib/student-reach';
import { isFamilyPrincipal } from '@/lib/student-visibility';
import { requireActiveSession } from '@/server/auth/session';

/**
 * Reads for the daily register.
 *
 * <p>Everything here is narrowed by the same reach the class screens use. A register is a list
 * of named children, so the question "which registers may I open" is the question "which
 * children may I see", and there is one answer to it in `student-reach.ts`.
 */

export const ATTENDANCE_PATH = '/attendance';

/** Today, in the school's timezone rather than the server's. */
export async function today(): Promise<string> {
  const session = await requireActiveSession();
  const tenant = await session.transaction((db) =>
    db.tenant.findFirst({ where: { id: session.tenantId }, select: { timezone: true } }),
  );
  return schoolToday(tenant?.timezone ?? 'Africa/Accra');
}

export interface RegisterSummary {
  classGroupId: string;
  classCode: string;
  className: string;
  sessionDate: string;
  registerId: string | null;
  status: RegisterViewStatus;
  totals: ReturnType<typeof totalsFor>;
  rate: number | null;
  isClassTeacher: boolean;
}

/**
 * Every class this person may take a register for, with the state of that day's register.
 *
 * <p>A class with no register yet shows a null status rather than being hidden: "nobody has
 * taken this one" is the single most important thing this screen has to say.
 */
export async function registersForDay(sessionDate: string): Promise<RegisterSummary[]> {
  const session = await requireActiveSession();
  if (isFamilyPrincipal(session.principalType)) return [];

  const reach = studentReach({
    principalType: session.principalType,
    principalId: session.principalId,
    membershipId: session.membershipId,
    permissions: session.permissions,
  });
  if (reach.kind === 'NONE' || !session.permissions.has(P.ATTENDANCE_VIEW)) return [];

  const date = toSessionDate(sessionDate);

  return session.transaction(async (db) => {
    const term = await db.term.findFirst({
      where: { startsOn: { lte: date }, endsOn: { gte: date } },
      select: { id: true },
    });
    if (!term) return [];

    const groups = await db.classGroup.findMany({
      where: classesInReach(reach),
      orderBy: [{ yearLevel: 'asc' }, { code: 'asc' }],
      take: 200,
      select: {
        id: true,
        code: true,
        name: true,
        classTeacherMembershipId: true,
        _count: {
          select: { enrolments: { where: { termId: term.id, status: { in: ['PENDING', 'ACTIVE'] } } } },
        },
        registers: {
          where: { sessionDate: date },
          select: { id: true, status: true, entries: { select: { status: true } } },
        },
      },
    });

    return groups.map((group) => {
      const register = group.registers[0] ?? null;
      const totals = totalsFor(group._count.enrolments, register?.entries ?? []);
      return {
        classGroupId: group.id,
        classCode: group.code,
        className: group.name,
        sessionDate,
        registerId: register?.id ?? null,
        status: (register?.status ?? 'NOT_TAKEN') as RegisterViewStatus,
        totals,
        rate: register ? attendanceRate(totals) : null,
        isClassTeacher: group.classTeacherMembershipId === session.membershipId,
      };
    });
  });
}

export interface RegisterLine {
  studentId: string;
  reference: string;
  name: string;
  /** Whether anything medical is on file. Never what it says — §4. */
  hasMedicalAlert: boolean;
  status: AttendanceStatusName | null;
  minutesLate: number | null;
  reason: string | null;
}

/**
 * `NOT_TAKEN` is not a database status — there is no row yet. It is carried here because "no
 * register exists for this class today" is the single most important thing the screen has to
 * say, and collapsing it into DRAFT would make an untaken register look like a started one.
 */
export type RegisterViewStatus = RegisterStatusName | 'NOT_TAKEN';

export interface RegisterView {
  classGroupId: string;
  classCode: string;
  className: string;
  termId: string;
  termName: string;
  yearName: string;
  sessionDate: string;
  registerId: string | null;
  status: RegisterViewStatus;
  lines: RegisterLine[];
  totals: ReturnType<typeof totalsFor>;
  rate: number | null;
  capabilities: ReturnType<typeof registerCapabilities>;
  /** Set when the day falls outside every term, which is a holiday rather than an error. */
  outsideYear: boolean;
}

export async function getRegister(
  classGroupId: string,
  sessionDate: string,
): Promise<RegisterView | null> {
  const session = await requireActiveSession();
  if (isFamilyPrincipal(session.principalType)) return null;

  const reach = studentReach({
    principalType: session.principalType,
    principalId: session.principalId,
    membershipId: session.membershipId,
    permissions: session.permissions,
  });
  if (reach.kind === 'NONE' || !session.permissions.has(P.ATTENDANCE_VIEW)) return null;

  const date = toSessionDate(sessionDate);

  return session.transaction(async (db) => {
    const group = await db.classGroup.findFirst({
      where: { id: classGroupId, ...classesInReach(reach) },
      select: {
        id: true,
        code: true,
        name: true,
        classTeacherMembershipId: true,
        academicYear: { select: { name: true } },
      },
    });
    if (!group) return null;

    const term = await db.term.findFirst({
      where: { startsOn: { lte: date }, endsOn: { gte: date } },
      select: { id: true, name: true },
    });

    const isClassTeacher = group.classTeacherMembershipId === session.membershipId;

    if (!term) {
      return {
        classGroupId: group.id,
        classCode: group.code,
        className: group.name,
        termId: '',
        termName: '',
        yearName: group.academicYear.name,
        sessionDate,
        registerId: null,
        status: 'NOT_TAKEN' as RegisterViewStatus,
        lines: [],
        totals: totalsFor(0, []),
        rate: null,
        capabilities: registerCapabilities('DRAFT', session.permissions, isClassTeacher),
        outsideYear: true,
      };
    }

    const [roll, register] = await Promise.all([
      rollForTerm(db, group.id, term.id),
      db.attendanceRegister.findFirst({
        where: { classGroupId: group.id, sessionDate: date },
        select: {
          id: true,
          status: true,
          entries: {
            select: { studentId: true, status: true, minutesLate: true, reason: true },
          },
        },
      }),
    ]);

    const marks = new Map(register?.entries.map((e) => [e.studentId, e]) ?? []);
    const stored = (register?.status ?? 'DRAFT') as RegisterStatusName;
    const status: RegisterViewStatus = register ? stored : 'NOT_TAKEN';

    const lines: RegisterLine[] = roll.map((row) => {
      const mark = marks.get(row.studentId);
      return {
        studentId: row.studentId,
        reference: row.student.reference,
        name: [row.student.preferredName ?? row.student.firstName, row.student.lastName]
          .filter(Boolean)
          .join(' '),
        hasMedicalAlert:
          session.permissions.has(P.HEALTH_ALERT_VIEW) &&
          Boolean(
            row.student.bloodType ||
              row.student.medicalNotes ||
              row.student.allergies ||
              row.student.specialNeeds,
          ),
        status: (mark?.status ?? null) as AttendanceStatusName | null,
        minutesLate: mark?.minutesLate ?? null,
        reason: mark?.reason ?? null,
      };
    });

    const totals = totalsFor(roll.length, register?.entries ?? []);

    return {
      classGroupId: group.id,
      classCode: group.code,
      className: group.name,
      termId: term.id,
      termName: term.name,
      yearName: group.academicYear.name,
      sessionDate,
      registerId: register?.id ?? null,
      status,
      lines,
      totals,
      rate: attendanceRate(totals),
      capabilities: registerCapabilities(stored, session.permissions, isClassTeacher),
      outsideYear: false,
    };
  });
}

export interface ChildAttendanceRow {
  sessionDate: string;
  classCode: string;
  status: string;
  minutesLate: number | null;
  reason: string | null;
}

/**
 * One child's attendance, for their own record page.
 *
 * <p>This is the path a guardian legitimately reaches attendance by — through their child,
 * never through the class. The caller is responsible for having established that the child is
 * theirs; `studentsInReach` is how.
 */
export async function attendanceForStudent(studentId: string): Promise<ChildAttendanceRow[]> {
  const session = await requireActiveSession();

  const rows = await session.transaction((db) =>
    db.attendanceEntry.findMany({
      where: { studentId },
      orderBy: { register: { sessionDate: 'desc' } },
      take: 60,
      select: {
        status: true,
        minutesLate: true,
        reason: true,
        register: { select: { sessionDate: true, classGroup: { select: { code: true } } } },
      },
    }),
  );

  return rows.map((row) => ({
    sessionDate: fromSessionDate(row.register.sessionDate),
    classCode: row.register.classGroup.code,
    status: row.status,
    minutesLate: row.minutesLate,
    reason: row.reason,
  }));
}
