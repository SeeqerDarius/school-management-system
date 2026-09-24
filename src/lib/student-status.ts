export const STUDENT_STATUSES = [
  'PROSPECTIVE', 'ENROLLED', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'DECEASED',
] as const;

export type StudentStatusValue = (typeof STUDENT_STATUSES)[number];

const transitions: Record<StudentStatusValue, readonly StudentStatusValue[]> = {
  PROSPECTIVE: ['ENROLLED', 'WITHDRAWN', 'DECEASED'],
  ENROLLED: ['ACTIVE', 'WITHDRAWN', 'DECEASED'],
  ACTIVE: ['SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'DECEASED'],
  SUSPENDED: ['ACTIVE', 'WITHDRAWN', 'DECEASED'],
  WITHDRAWN: [],
  GRADUATED: [],
  DECEASED: [],
};

export function canTransitionStudent(from: StudentStatusValue, to: StudentStatusValue): boolean {
  return transitions[from].includes(to);
}
