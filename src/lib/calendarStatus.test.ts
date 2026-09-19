import { describe, expect, it } from 'vitest';

import {
  allowedTransitions,
  canTransition,
  daysBetween,
  isEditable,
  statusLabel,
  statusTone,
  validateTermRange,
  validateYearRange,
} from '@/lib/calendar-status';

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('calendar state machine', () => {
  it('lets a planned period be activated or abandoned', () => {
    expect(allowedTransitions('PLANNED')).toEqual(['ACTIVE', 'CLOSED']);
  });

  it('lets an active period only be closed', () => {
    expect(allowedTransitions('ACTIVE')).toEqual(['CLOSED']);
  });

  /**
   * The one that matters. Reopening a closed year would change what an already-issued report
   * card means, so CLOSED is terminal — and a future refactor that "helpfully" adds a reopen
   * path should have to delete this test to do it.
   */
  it('never reopens a closed period', () => {
    expect(allowedTransitions('CLOSED')).toEqual([]);
    expect(canTransition('CLOSED', 'ACTIVE')).toBe(false);
    expect(canTransition('CLOSED', 'PLANNED')).toBe(false);
    expect(canTransition('CLOSED', 'CLOSED')).toBe(false);
  });

  it('never moves backwards from active to planned', () => {
    expect(canTransition('ACTIVE', 'PLANNED')).toBe(false);
  });

  it('only treats a planned period as editable', () => {
    expect(isEditable('PLANNED')).toBe(true);
    expect(isEditable('ACTIVE')).toBe(false);
    expect(isEditable('CLOSED')).toBe(false);
  });

  it('labels and tones every state', () => {
    for (const status of ['PLANNED', 'ACTIVE', 'CLOSED'] as const) {
      expect(statusLabel(status)).toBeTruthy();
      expect(statusTone(status)).toBeTruthy();
    }
  });
});

describe('date ranges', () => {
  it('counts whole days between two dates', () => {
    expect(daysBetween(date('2026-09-01'), date('2026-09-08'))).toBe(7);
  });

  it('counts whole days across a daylight-saving boundary', () => {
    // Both are UTC midnight, so the count is unaffected by any local clock change. A naive
    // implementation using local time returns 30.958… here and rounds to the wrong day.
    expect(daysBetween(date('2026-03-01'), date('2026-04-01'))).toBe(31);
  });

  describe('academic year', () => {
    it('accepts an ordinary school year', () => {
      expect(validateYearRange(date('2026-09-07'), date('2027-07-23'))).toBeNull();
    });

    it('rejects an end before the start', () => {
      expect(validateYearRange(date('2027-07-23'), date('2026-09-07'))).toMatch(/after the start/);
    });

    it('rejects a zero-length year', () => {
      expect(validateYearRange(date('2026-09-07'), date('2026-09-07'))).toMatch(/after the start/);
    });

    it('rejects a mistyped decade', () => {
      expect(validateYearRange(date('2026-09-07'), date('2036-07-23'))).toMatch(/18 months/);
    });

    it('rejects a fortnight', () => {
      expect(validateYearRange(date('2026-09-07'), date('2026-09-21'))).toMatch(/shorter than a month/);
    });
  });

  describe('term', () => {
    const year = { startsOn: date('2026-09-07'), endsOn: date('2027-07-23') };

    it('accepts a term inside its year', () => {
      expect(validateTermRange(date('2026-09-07'), date('2026-12-18'), year)).toBeNull();
    });

    it('accepts a term that exactly fills the start of its year', () => {
      expect(validateTermRange(year.startsOn, date('2026-12-18'), year)).toBeNull();
    });

    it('rejects a term starting before its year', () => {
      expect(validateTermRange(date('2026-09-01'), date('2026-12-18'), year)).toMatch(
        /starts before/,
      );
    });

    it('rejects a term ending after its year', () => {
      expect(validateTermRange(date('2027-05-01'), date('2027-08-30'), year)).toMatch(/ends after/);
    });

    it('rejects a term shorter than a week', () => {
      expect(validateTermRange(date('2026-09-07'), date('2026-09-10'), year)).toMatch(
        /shorter than a week/,
      );
    });

    it('rejects a term longer than eight months', () => {
      expect(validateTermRange(date('2026-09-07'), date('2027-07-01'), year)).toMatch(
        /longer than eight months/,
      );
    });
  });
});
