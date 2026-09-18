import { z } from 'zod';

/**
 * The academic calendar contract, as the core API actually returns it.
 *
 * These schemas are the trust boundary. They are written to match
 * `AcademicYearController.AcademicYearResponse` and `TermResponse`, and a mismatch between the
 * two surfaces as a named parse failure rather than as `undefined` quietly rendering into a page.
 */

export const calendarStatusSchema = z.enum(['PLANNED', 'ACTIVE', 'CLOSED']);
export type CalendarStatus = z.infer<typeof calendarStatusSchema>;

/**
 * An ISO calendar date with no time and no zone.
 *
 * Invariant I-7: a term boundary is a date, not an instant. Parsing it into a `Date` here would
 * attach a timezone and shift the day for anyone east or west of the server — which is how a
 * term appears to start on the 31st in Accra and the 30th somewhere else.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');

export const academicYearSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  startsOn: isoDate,
  endsOn: isoDate,
  status: calendarStatusSchema,
  current: z.boolean(),
  /** What the server says may happen next, so the UI never reimplements the state machine. */
  allowedTransitions: z.array(calendarStatusSchema),
  editable: z.boolean(),
  version: z.number().int().nonnegative(),
});

export type AcademicYear = z.infer<typeof academicYearSchema>;

export const termSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  sequence: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  startsOn: isoDate,
  endsOn: isoDate,
  reportsDueOn: isoDate.nullable(),
  status: calendarStatusSchema,
  current: z.boolean(),
  allowedTransitions: z.array(calendarStatusSchema),
  editable: z.boolean(),
  version: z.number().int().nonnegative(),
});

export type Term = z.infer<typeof termSchema>;

export const academicYearListSchema = z.array(academicYearSchema);
export const termListSchema = z.array(termSchema);

// ---------------------------------------------------------------------------------------
// Form input
//
// Validated client-side for the user's benefit and server-side for everyone's. The server is
// the one that decides; this exists so a typo is caught before a round trip, not instead of one.
// ---------------------------------------------------------------------------------------

export const createAcademicYearInput = z
  .object({
    code: z.string().trim().min(1, 'Enter a code, such as 2026/2027').max(32),
    name: z.string().trim().min(1, 'Enter a name').max(120),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine((value) => value.endsOn > value.startsOn, {
    message: 'The end date must be after the start date',
    path: ['endsOn'],
  });

export type CreateAcademicYearInput = z.infer<typeof createAcademicYearInput>;

export const createTermInput = z
  .object({
    code: z.string().trim().min(1, 'Enter a code, such as T1').max(32),
    name: z.string().trim().min(1, 'Enter a name, such as First Term').max(120),
    startsOn: isoDate,
    endsOn: isoDate,
    reportsDueOn: isoDate.optional(),
  })
  .refine((value) => value.endsOn > value.startsOn, {
    message: 'The end date must be after the start date',
    path: ['endsOn'],
  });

export type CreateTermInput = z.infer<typeof createTermInput>;

export const reasonInput = z.object({
  reason: z
    .string()
    .trim()
    // Matched to the server rule. Closing a period is recorded forever; "x" is not a reason.
    .min(3, 'Say briefly why — this is recorded in the audit trail')
    .max(500),
});
