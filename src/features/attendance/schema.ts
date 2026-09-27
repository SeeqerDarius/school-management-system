import { z } from 'zod';

/**
 * Input validation for the register.
 *
 * <p>The shape of {@link markInput} is the whole lesson of the first attempt at this module.
 * `status` is **nullable**, and that is deliberate: requiring one per child made the entire
 * submission fail Zod validation the moment a single child was unmarked. The teacher pressed
 * the button, every mark they had entered was discarded, and the screen said nothing —
 * invariant I-8 from the wrong side.
 *
 * <p>So a half-finished register is a valid thing to save, and completeness is checked at
 * submission, where there is a specific message to give and nothing to lose.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in the form YYYY-MM-DD');

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export type AttendanceStatusName = (typeof ATTENDANCE_STATUSES)[number];

export const attendanceStatus = z.enum(ATTENDANCE_STATUSES);

export const markInput = z.object({
  studentId: z.string().uuid(),
  status: attendanceStatus.nullable(),
  minutesLate: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(600)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const saveRegisterInput = z.object({
  classGroupId: z.string().uuid(),
  sessionDate: isoDate,
  marks: z.array(markInput).max(300),
  /** Submitting is a separate intent from saving, and the completeness rule only applies to it. */
  submit: z.boolean(),
  /** Required when changing a register that has already been submitted. */
  correctionReason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const lockRegisterInput = z.object({
  registerId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(8, 'Say what this register is being locked for — a statutory return, an end-of-term close')
    .max(300),
});

export type MarkInput = z.infer<typeof markInput>;
export type SaveRegisterInput = z.infer<typeof saveRegisterInput>;
