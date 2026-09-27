import { P } from '@/lib/permissions';

/**
 * Which children a person may reach at all.
 *
 * <p>Distinct from `student-visibility.ts`, which answers which *fields* of a record they see.
 * Getting visibility wrong shows too much of one child; getting reach wrong shows every child in
 * the school. This module is the second one.
 *
 * <h2>The line the catalogue already draws</h2>
 * A permission says what somebody may do; it cannot say to whom. The seeded catalogue already
 * separates the two roster permissions, and they are already assigned correctly:
 *
 * <ul>
 *   <li>`STUDENT_VIEW` — the school-wide roll. Headmaster, registrar, admissions, bursar,
 *       nurse, and the rest of the people who run the school.</li>
 *   <li>`STUDENT_VIEW_OWN_CLASS` — "the children in front of me". Teacher, class teacher,
 *       head of department.</li>
 * </ul>
 *
 * <p>What went wrong is that nothing read it. `STUDENT_READ` was added later and granted to
 * TEACHER alongside the administrators, and the queries gated on that alone — so a teacher
 * listing students got every child in the school, with guardian phone numbers attached. This
 * module exists so the line the catalogue draws is the line the queries enforce.
 *
 * <p>A guardian is not on that scale at all. Their reach is which children are theirs, which no
 * permission code can express.
 */
export type StudentReach =
  /** Every child in the school. */
  | { kind: 'ALL_STUDENTS' }
  /** Only children enrolled in a class this membership is the class teacher of. */
  | { kind: 'OWN_CLASSES'; membershipId: string }
  /** Only this guardian's own children, through a link that has not been revoked. */
  | { kind: 'OWN_CHILDREN'; guardianId: string }
  /** Nobody. */
  | { kind: 'NONE' };

export interface StudentViewer {
  principalType: string;
  principalId: string | null;
  membershipId: string;
  permissions: ReadonlySet<string>;
}

export function studentReach(viewer: StudentViewer): StudentReach {
  if (viewer.principalType === 'GUARDIAN') {
    // A guardian with no guardian row reaches nothing, rather than reaching everything. The
    // same fail-closed default the visibility matrix uses (§13.5).
    return viewer.principalId
      ? { kind: 'OWN_CHILDREN', guardianId: viewer.principalId }
      : { kind: 'NONE' };
  }

  // A pupil's own record is not built yet. Until it is, the safe answer is nothing rather
  // than falling through to the staff rules below.
  if (viewer.principalType === 'STUDENT') return { kind: 'NONE' };

  if (viewer.permissions.has(P.STUDENT_VIEW)) return { kind: 'ALL_STUDENTS' };

  if (viewer.permissions.has(P.STUDENT_VIEW_OWN_CLASS)) {
    return { kind: 'OWN_CLASSES', membershipId: viewer.membershipId };
  }

  // Holding STUDENT_READ and neither roster permission names no roster, so it reaches no
  // roster. That is a misconfiguration, and the safe reading of one is "no".
  return { kind: 'NONE' };
}

/**
 * The `where` fragment that expresses a reach.
 *
 * <p>Narrowed in the query, never filtered in the template. A query that fetches every child and
 * hides some when rendering has already sent every child to the server component, and one added
 * column or one `console.log` puts them on the page.
 *
 * <p>**A subject teacher who is not a class teacher reaches nothing here, and that is
 * deliberate.** "Classes they teach" needs teaching assignments, which need a timetable, which
 * does not exist yet. Approximating it with "every class" is the bug this module was written to
 * fix, so the gap is left open and visible instead.
 */
export function studentsInReach(reach: StudentReach): Record<string, unknown> {
  switch (reach.kind) {
    case 'ALL_STUDENTS':
      return {};
    case 'OWN_CLASSES':
      return {
        enrollments: {
          some: { classGroup: { classTeacherMembershipId: reach.membershipId } },
        },
      };
    case 'OWN_CHILDREN':
      // A revoked link is not a link. This is what the revocation column is for.
      return {
        guardianships: { some: { guardianId: reach.guardianId, revokedAt: null } },
      };
    case 'NONE':
      // Stated as a contradiction rather than an omitted filter: an empty `where` here would
      // return every child in the school, which is precisely the failure being prevented.
      return { id: '00000000-0000-0000-0000-000000000000' };
  }
}
