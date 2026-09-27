import { describe, expect, it } from 'vitest';

import { canTransitionEnrolment, ENROLMENT_STATUSES } from './enrolment-status';

describe('enrolment status transitions', () => {
  it('permits the documented enrolment lifecycle', () => {
    expect(canTransitionEnrolment('PENDING', 'ACTIVE')).toBe(true);
    expect(canTransitionEnrolment('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionEnrolment('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionEnrolment('ACTIVE', 'COMPLETED')).toBe(true);
  });

  it('keeps completed and withdrawn enrolments terminal', () => {
    expect(canTransitionEnrolment('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransitionEnrolment('COMPLETED', 'ACTIVE')).toBe(false);
    expect(canTransitionEnrolment('WITHDRAWN', 'ACTIVE')).toBe(false);
    for (const status of ENROLMENT_STATUSES) expect(canTransitionEnrolment(status, status)).toBe(false);
  });
});
