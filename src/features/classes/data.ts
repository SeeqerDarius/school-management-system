import 'server-only';

import { P } from '@/lib/permissions';
import { isFamilyPrincipal } from '@/lib/student-visibility';
import { studentReach, type StudentReach } from '@/lib/student-reach';
import { PermissionDeniedError, requireActiveSession } from '@/server/auth/session';
import type { TenantTx } from '@/server/tenant-scope';

/**
 * Reads for classes and enrolment.
 *
 * <p>The list a person sees is narrowed by {@link studentReach}, not filtered afterwards. The
 * difference matters: a query that fetches every class and hides some in the template still
 * sent every class to the server component, and one careless `console.log` or one added column
 * puts it on the page.
 */

export const CLASSES_PATH = '/classes';

/**
 * The `where` clause that expresses a person's reach over classes.
 *
 * <p>Exported because attendance uses the same restriction, and two definitions of "which
 * classes are mine" would eventually disagree — which, on this particular question, means a
 * teacher seeing another class's children.
 */
export function classesInReach(reach: StudentReach): Record<string, unknown> {
  switch (reach.kind) {
    case 'ALL_STUDENTS':
      return {};
    case 'OWN_CLASSES':
      return { classTeacherMembershipId: reach.membershipId };
    case 'OWN_CHILDREN':
      // A guardian reaches a class only through a child in it, and only through a live link.
      return {
        enrolments: {
          some: {
            status: { in: ['PENDING', 'ACTIVE'] },
            student: { guardianships: { some: { guardianId: reach.guardianId, revokedAt: null } } },
          },
        },
      };
    case 'NONE':
      // Impossible in Prisma's own terms, so it is stated as a contradiction rather than an
      // omitted filter: an empty `where` here would return every class in the school.
      return { id: '00000000-0000-0000-0000-000000000000' };
  }
}

export interface ClassRow {
  id: string;
  code: string;
  name: string;
  yearLevel: number | null;
  academicYearName: string;
  academicYearId: string;
  campusName: string;
  classTeacherMembershipId: string | null;
  classTeacherName: string | null;
  rollSize: number;
  isClassTeacher: boolean;
}

export async function listClasses(): Promise<ClassRow[]> {
  const session = await requireActiveSession();

  // A family never lists classes. They can reach one through their child — which is how a
  // parent sees the register their child was marked on — but the class screens are roster
  // management, and a roster is a list of other people's children. §4 gives a guardian "their
  // own linked children only", and names another family's child as something they must not see.
  if (isFamilyPrincipal(session.principalType)) return [];

  const reach = studentReach({
    principalType: session.principalType,
    principalId: session.principalId,
    membershipId: session.membershipId,
    permissions: session.permissions,
  });

  // Nothing to list rather than a thrown refusal. A bursar has neither CLASS_VIEW nor a roster
  // permission and has no business here — but throwing turns that into a 500 with a digest,
  // which reads as the product being broken rather than as a rule. The page renders the
  // refusal; this returns the empty answer that is true for them.
  if (reach.kind === 'NONE' && !session.permissions.has(P.CLASS_VIEW)) return [];

  // CLASS_VIEW without a roster reach still lists the school's classes — a registrar organises
  // them without ever taking a register. It does not widen a teacher, whose reach is already
  // the narrower of the two.
  const where =
    reach.kind === 'ALL_STUDENTS' || (reach.kind === 'NONE' && session.permissions.has(P.CLASS_VIEW))
      ? {}
      : classesInReach(reach);

  const rows = await session.transaction((db) =>
    db.classGroup.findMany({
      where,
      orderBy: [{ yearLevel: 'asc' }, { code: 'asc' }],
      take: 300,
      select: {
        id: true,
        code: true,
        name: true,
        yearLevel: true,
        academicYearId: true,
        classTeacherMembershipId: true,
        academicYear: { select: { name: true } },
        campus: { select: { name: true } },
        classTeacher: { select: { user: { select: { fullName: true, preferredName: true } } } },
        _count: { select: { enrolments: { where: { status: { in: ['PENDING', 'ACTIVE'] } } } } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    yearLevel: row.yearLevel,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYear.name,
    campusName: row.campus.name,
    classTeacherMembershipId: row.classTeacherMembershipId,
    classTeacherName: row.classTeacher?.user.preferredName ?? row.classTeacher?.user.fullName ?? null,
    rollSize: row._count.enrolments,
    isClassTeacher: row.classTeacherMembershipId === session.membershipId,
  }));
}

export interface RollEntry {
  enrolmentId: string;
  studentId: string;
  reference: string;
  name: string;
  termName: string;
  status: string;
  enrolmentDate: Date;
  completionDate: Date | null;
  remarks: string | null;
}

export interface ClassDetail extends ClassRow {
  roll: RollEntry[];
  canManage: boolean;
  canEnrol: boolean;
}

export async function getClass(id: string): Promise<ClassDetail | null> {
  const session = await requireActiveSession();

  // Null rather than a refusal, and refused before the query rather than filtered after it:
  // this page returns a whole roll, and a guardian reaching it through their own child's class
  // would have been shown every other child in the room by name and reference.
  if (isFamilyPrincipal(session.principalType)) return null;

  const reach = studentReach({
    principalType: session.principalType,
    principalId: session.principalId,
    membershipId: session.membershipId,
    permissions: session.permissions,
  });

  // Null, for the same reason getStudentById returns null: the page turns it into a 404, and
  // "no such class" is the right answer to give somebody who may not see this one.
  const mayOrganise = session.permissions.has(P.CLASS_VIEW);
  if (reach.kind === 'NONE' && !mayOrganise) return null;

  const where =
    reach.kind === 'ALL_STUDENTS' || (reach.kind === 'NONE' && mayOrganise)
      ? { id }
      : { id, ...classesInReach(reach) };

  const row = await session.transaction((db) =>
    db.classGroup.findFirst({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        yearLevel: true,
        academicYearId: true,
        classTeacherMembershipId: true,
        academicYear: { select: { name: true } },
        campus: { select: { name: true } },
        classTeacher: { select: { user: { select: { fullName: true, preferredName: true } } } },
        enrolments: {
          orderBy: [{ term: { sequence: 'asc' } }, { student: { lastName: 'asc' } }],
          select: {
            id: true,
            status: true,
            enrolmentDate: true,
            completionDate: true,
            remarks: true,
            term: { select: { name: true } },
            student: {
              select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true },
            },
          },
        },
      },
    }),
  );

  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    yearLevel: row.yearLevel,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYear.name,
    campusName: row.campus.name,
    classTeacherMembershipId: row.classTeacherMembershipId,
    classTeacherName: row.classTeacher?.user.preferredName ?? row.classTeacher?.user.fullName ?? null,
    rollSize: row.enrolments.filter((e) => e.status === 'PENDING' || e.status === 'ACTIVE').length,
    isClassTeacher: row.classTeacherMembershipId === session.membershipId,
    roll: row.enrolments.map((enrolment) => ({
      enrolmentId: enrolment.id,
      studentId: enrolment.student.id,
      reference: enrolment.student.reference,
      name: [enrolment.student.preferredName ?? enrolment.student.firstName, enrolment.student.lastName]
        .filter(Boolean)
        .join(' '),
      termName: enrolment.term.name,
      status: enrolment.status,
      enrolmentDate: enrolment.enrolmentDate,
      completionDate: enrolment.completionDate,
      remarks: enrolment.remarks,
    })),
    canManage: session.permissions.has(P.CLASS_MANAGE),
    canEnrol: session.permissions.has(P.ADMISSION_ENROL),
  };
}

/** Academic years a class can be created in. Closed years are not offered. */
export async function selectableYears() {
  const session = await requireActiveSession();
  return session.transaction((db) =>
    db.academicYear.findMany({
      where: { status: { in: ['PLANNED', 'ACTIVE'] } },
      orderBy: { startsOn: 'desc' },
      select: { id: true, name: true, code: true, isCurrent: true },
    }),
  );
}

/** Campuses a class can sit on. */
export async function selectableCampuses() {
  const session = await requireActiveSession();
  return session.transaction((db) =>
    db.campus.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    }),
  );
}

/** Terms an enrolment can be made for. */
export async function selectableTerms(academicYearId: string) {
  const session = await requireActiveSession();
  return session.transaction((db) =>
    db.term.findMany({
      where: { academicYearId, status: { in: ['PLANNED', 'ACTIVE'] } },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true, sequence: true, startsOn: true, endsOn: true },
    }),
  );
}

/** Staff who could be a class teacher. Guardians and pupils are not offered. */
export async function assignableTeachers() {
  const session = await requireActiveSession();
  if (!session.permissions.has(P.CLASS_MANAGE)) throw new PermissionDeniedError(P.CLASS_MANAGE);

  return session.transaction((db) =>
    db.membership.findMany({
      where: { status: 'ACTIVE', principalType: { in: ['STAFF', 'TEACHER'] } },
      orderBy: { createdAt: 'asc' },
      take: 300,
      select: { id: true, displayTitle: true, user: { select: { fullName: true, preferredName: true } } },
    }),
  );
}

/** Children not already enrolled for the given term. */
export async function enrollableStudents(termId: string) {
  const session = await requireActiveSession();
  if (!session.permissions.has(P.ADMISSION_ENROL)) throw new PermissionDeniedError(P.ADMISSION_ENROL);

  return session.transaction((db) =>
    db.student.findMany({
      where: {
        status: { in: ['PROSPECTIVE', 'ENROLLED', 'ACTIVE'] },
        // The database refuses a second enrolment in the same term outright; offering children
        // it would refuse is a form that fails after the click rather than before it.
        enrollments: { none: { termId } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
      select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true },
    }),
  );
}

/**
 * The roll of a class for a given term, in register order. Shared with the attendance module.
 *
 * <p>Enrolment here is term-shaped rather than date-ranged, so "who is on the roll that day" is
 * "who is enrolled in the term the day falls in" — which is also exactly what the submission
 * completeness trigger counts, so the screen and the database agree by construction.
 */
export async function rollForTerm(db: TenantTx, classGroupId: string, termId: string) {
  return db.enrolment.findMany({
    where: { classId: classGroupId, termId, status: { in: ['PENDING', 'ACTIVE'] } },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    select: {
      studentId: true,
      student: {
        select: {
          id: true,
          reference: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          // The alert flag only — never the notes. §4 gives a teacher "alert on file, contact
          // the nurse", and student-visibility.ts is where that rule is written down.
          bloodType: true,
          medicalNotes: true,
          allergies: true,
          specialNeeds: true,
        },
      },
    },
  });
}
