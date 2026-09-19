import { z } from 'zod';

/**
 * Input validation for the academic calendar.
 *
 * <p>Runs on the server inside each action. The forms also surface these messages as the user
 * types, but that is a courtesy — the server is what decides, every time, regardless of what
 * the browser submitted.
 */

/**
 * An ISO calendar date with no time and no zone.
 *
 * <p>Kept as a string until the last moment. Parsing "2026-09-08" with `new Date()` attaches
 * UTC midnight, which renders as the 7th for anyone west of Greenwich — which is how a term
 * comes to appear to start a day early.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in the form YYYY-MM-DD');

/** Converts an ISO date string to a Date at UTC midnight, matching Postgres `date`. */
export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Formats a Date from a Postgres `date` column back to ISO, without timezone drift. */
export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const createAcademicYearInput = z
  .object({
    code: z.string().trim().min(1, 'Enter a code, such as 2026/2027').max(32),
    name: z.string().trim().min(1, 'Enter a name').max(120),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine((v) => v.endsOn > v.startsOn, {
    message: 'The end date must be after the start date',
    path: ['endsOn'],
  });

export const updateAcademicYearInput = createAcademicYearInput;

export const createTermInput = z
  .object({
    code: z.string().trim().min(1, 'Enter a code, such as T1').max(32),
    name: z.string().trim().min(1, 'Enter a name, such as First Term').max(120),
    startsOn: isoDate,
    endsOn: isoDate,
    reportsDueOn: isoDate.optional(),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    message: 'The end date must be after the start date',
    path: ['endsOn'],
  });

export const reasonInput = z.object({
  reason: z
    .string()
    .trim()
    // Closing a period is recorded against your name forever. "x" is not a reason.
    .min(3, 'Say briefly why — this is recorded in the audit trail')
    .max(500),
});
