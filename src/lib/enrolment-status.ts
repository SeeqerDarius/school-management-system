export const ENROLMENT_STATUSES = ['PENDING', 'ACTIVE', 'COMPLETED', 'WITHDRAWN', 'SUSPENDED'] as const;
export type EnrolmentStatusValue = (typeof ENROLMENT_STATUSES)[number];

const transitions: Record<EnrolmentStatusValue, readonly EnrolmentStatusValue[]> = {
  PENDING: ['ACTIVE', 'WITHDRAWN'],
  ACTIVE: ['COMPLETED', 'WITHDRAWN', 'SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'WITHDRAWN'],
  COMPLETED: [],
  WITHDRAWN: [],
};

export function canTransitionEnrolment(from: EnrolmentStatusValue, to: EnrolmentStatusValue): boolean {
  return transitions[from].includes(to);
}
