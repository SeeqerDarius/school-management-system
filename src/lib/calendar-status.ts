import type { CalendarStatus } from '@prisma/client';

/**
 * Re-exported so client components can name the type without importing `@prisma/client`.
 * The import above is type-only and erased at compile time, so no database client reaches the
 * browser bundle.
 */
export type { CalendarStatus };

/**
 * The academic calendar state machine.
 *
 * <p>An explicit set of transitions rather than a scattering of booleans. `isActive`,
 * `isClosed` and `isPlanned` as separate flags admit combinations that mean nothing — closed
 * and active at once — and then every read site has to decide what such a row means.
 *
 * <p>Transitions live here rather than at each call site, so "can a closed year be reopened"
 * has exactly one answer in the codebase.
 */

const TRANSITIONS: Record<CalendarStatus, CalendarStatus[]> = {
  /** Created, dates set, not yet in use. Freely editable. */
  PLANNED: ['ACTIVE', 'CLOSED'],
  /** In use. Attendance, marks and invoices reference it; dates are no longer editable. */
  ACTIVE: ['CLOSED'],
  /**
   * Terminal by design. Reopening would silently change what an already-issued report card
   * means, so correction happens by amendment within the year's own records.
   */
  CLOSED: [],
};

export function allowedTransitions(from: CalendarStatus): CalendarStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: CalendarStatus, to: CalendarStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Whether dates and naming may still be changed freely. */
export function isEditable(status: CalendarStatus): boolean {
  return status === 'PLANNED';
}

export function statusLabel(status: CalendarStatus): string {
  switch (status) {
    case 'PLANNED':
      return 'Planned';
    case 'ACTIVE':
      return 'Active';
    case 'CLOSED':
      return 'Closed';
  }
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** One mapping from lifecycle state to visual tone, used everywhere. */
export function statusTone(status: CalendarStatus): StatusTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'PLANNED':
      return 'info';
    case 'CLOSED':
      return 'neutral';
  }
}

// ---------------------------------------------------------------------------------------
// Date-range rules
//
// The database enforces ordering and non-overlap. These catch the mistakes a person actually
// makes — a year spanning a decade because a digit was mistyped, or a two-week "year" — which
// the database would accept happily and which only surface as nonsense in a report months on.
// ---------------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

export const YEAR_MIN_DAYS = 30;
export const YEAR_MAX_DAYS = 550;
export const TERM_MIN_DAYS = 7;
export const TERM_MAX_DAYS = 250;

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

/** Returns an error message, or null when the range is plausible. */
export function validateYearRange(startsOn: Date, endsOn: Date): string | null {
  if (endsOn <= startsOn) return 'The end date must be after the start date';
  const days = daysBetween(startsOn, endsOn);
  if (days > YEAR_MAX_DAYS) return 'That is longer than 18 months — check the end date';
  if (days < YEAR_MIN_DAYS) return 'That is shorter than a month — check the dates';
  return null;
}

export function validateTermRange(
  startsOn: Date,
  endsOn: Date,
  year: { startsOn: Date; endsOn: Date },
): string | null {
  if (endsOn <= startsOn) return 'The end date must be after the start date';

  const days = daysBetween(startsOn, endsOn);
  if (days < TERM_MIN_DAYS) return 'That term is shorter than a week — check the dates';
  if (days > TERM_MAX_DAYS) return 'That term is longer than eight months — check the dates';

  if (startsOn < year.startsOn) return 'The term starts before the academic year does';
  if (endsOn > year.endsOn) return 'The term ends after the academic year does';

  return null;
}
