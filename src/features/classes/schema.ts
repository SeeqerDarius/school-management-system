import { z } from 'zod';

/**
 * Input validation for classes and enrolment.
 *
 * <p>There is no enum of class names here, and there will not be one. §136 and §137: a Ghanaian
 * school's structure — Basic 1 to 9, JHS, SHS Form 3 — is **data**, and a school in another
 * country types something else entirely. `yearLevel` is a sort key and nothing more; the school
 * decides what level 5 is called.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in the form YYYY-MM-DD');

export const createClassInput = z.object({
  academicYearId: z.string().uuid('Choose the academic year this class runs in'),
  campusId: z.string().uuid('Choose the campus this class sits on'),
  code: z
    .string()
    .trim()
    .min(1, 'Give the class a short code, such as B5A')
    .max(24)
    // Uppercased so "b5a" and "B5A" are the same class rather than two. The unique index is
    // case-sensitive, and a school that creates both will be taking two registers for one room.
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'Give the class a name, such as Basic 5 A').max(120),
  yearLevel: z
    .union([z.literal(''), z.coerce.number().int().min(0).max(30)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  classTeacherMembershipId: z.string().uuid().optional().or(z.literal('')),
});

export const assignClassTeacherInput = z.object({
  classGroupId: z.string().uuid(),
  /** Empty clears the assignment, which removes that teacher's reach over the class. */
  membershipId: z.string().uuid().optional().or(z.literal('')),
});

/**
 * Putting a child in a class.
 *
 * <p>An enrolment here belongs to a **term**, not to a date range — that is how this schema
 * models it, and `@@unique([studentId, termId])` means a child has exactly one enrolment per
 * term. Moving a child to another class mid-year is therefore a new enrolment in the next term,
 * not an edit, which is what keeps a register correct on both sides of the move.
 */
export const enrolStudentInput = z.object({
  classGroupId: z.string().uuid(),
  termId: z.string().uuid('Choose the term this enrolment is for'),
  studentId: z.string().uuid('Choose a child'),
  enrolmentDate: isoDate,
});

/**
 * Taking a child out of a class.
 *
 * <p>The row is not deleted and the class is not blanked. The enrolment is closed with a status
 * and a date, because "this child was in B5A until December" is a fact somebody will need to
 * read back — a register for a past day has to still make sense.
 */
export const endEnrolmentInput = z.object({
  enrolmentId: z.string().uuid(),
  completionDate: isoDate,
  status: z.enum(['COMPLETED', 'WITHDRAWN', 'SUSPENDED']),
  remarks: z.string().trim().min(1, 'Say why they are leaving this class').max(300),
});

export type CreateClassInput = z.infer<typeof createClassInput>;
export type EnrolStudentInput = z.infer<typeof enrolStudentInput>;
export type EndEnrolmentInput = z.infer<typeof endEnrolmentInput>;
