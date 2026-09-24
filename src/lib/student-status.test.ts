import { describe, expect, it } from 'vitest';

import { canTransitionStudent, STUDENT_STATUSES } from './student-status';

describe('student status transitions', () => {
  it('allows only the documented progress and exit transitions', () => {
    expect(canTransitionStudent('PROSPECTIVE', 'ENROLLED')).toBe(true);
    expect(canTransitionStudent('ENROLLED', 'ACTIVE')).toBe(true);
    expect(canTransitionStudent('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionStudent('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionStudent('ACTIVE', 'GRADUATED')).toBe(true);
    expect(canTransitionStudent('PROSPECTIVE', 'WITHDRAWN')).toBe(true);
  });

  it('keeps terminal states closed and rejects skipped transitions', () => {
    expect(canTransitionStudent('PROSPECTIVE', 'ACTIVE')).toBe(false);
    expect(canTransitionStudent('ACTIVE', 'PROSPECTIVE')).toBe(false);
    expect(canTransitionStudent('WITHDRAWN', 'ACTIVE')).toBe(false);
    expect(canTransitionStudent('GRADUATED', 'ACTIVE')).toBe(false);
    expect(canTransitionStudent('DECEASED', 'ACTIVE')).toBe(false);
  });

  it('defines transitions for every status', () => {
    for (const status of STUDENT_STATUSES) {
      expect(canTransitionStudent(status, status)).toBe(false);
    }
  });
});
