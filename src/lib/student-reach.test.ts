import { describe, expect, it } from 'vitest';

import { P } from '@/lib/permissions';
import { studentReach, studentsInReach, type StudentViewer } from '@/lib/student-reach';

const viewer = (permissions: string[], over: Partial<StudentViewer> = {}): StudentViewer => ({
  principalType: 'STAFF',
  principalId: null,
  membershipId: 'membership-1',
  permissions: new Set(permissions),
  ...over,
});

describe('how far a person reaches', () => {
  it('gives the school-wide roll to whoever holds STUDENT_VIEW', () => {
    expect(studentReach(viewer([P.STUDENT_VIEW, P.STUDENT_READ]))).toEqual({ kind: 'ALL_STUDENTS' });
  });

  it('gives a teacher their own classes, not the school', () => {
    // The assertion this module exists for. A teacher holds STUDENT_READ exactly as an
    // administrator does; what separates them is the roster permission.
    expect(
      studentReach(viewer([P.STUDENT_READ, P.STUDENT_VIEW_OWN_CLASS], { membershipId: 'm-9' })),
    ).toEqual({ kind: 'OWN_CLASSES', membershipId: 'm-9' });
  });

  it('gives nothing to STUDENT_READ on its own', () => {
    // Before this, STUDENT_READ alone returned every child in the school.
    expect(studentReach(viewer([P.STUDENT_READ]))).toEqual({ kind: 'NONE' });
  });

  it('gives a guardian their own children', () => {
    expect(
      studentReach(viewer([], { principalType: 'GUARDIAN', principalId: 'guardian-a' })),
    ).toEqual({ kind: 'OWN_CHILDREN', guardianId: 'guardian-a' });
  });

  it('gives a guardian nothing when the membership has no guardian row', () => {
    expect(studentReach(viewer([], { principalType: 'GUARDIAN', principalId: null }))).toEqual({
      kind: 'NONE',
    });
  });

  it('does not widen a guardian who somehow holds the staff roster permission', () => {
    expect(
      studentReach(
        viewer([P.STUDENT_VIEW, P.STUDENT_READ], { principalType: 'GUARDIAN', principalId: 'g-a' }),
      ),
    ).toEqual({ kind: 'OWN_CHILDREN', guardianId: 'g-a' });
  });

  it('gives a pupil nothing, because their own record is not built yet', () => {
    expect(
      studentReach(viewer([P.STUDENT_VIEW], { principalType: 'STUDENT', principalId: 's-1' })),
    ).toEqual({ kind: 'NONE' });
  });
});

describe('the where clause a reach becomes', () => {
  it('is empty for the whole school', () => {
    expect(studentsInReach({ kind: 'ALL_STUDENTS' })).toEqual({});
  });

  it('is an impossible id for nobody, never an empty filter', () => {
    // An omitted filter here returns every child, so "nobody" is written as a contradiction.
    const where = studentsInReach({ kind: 'NONE' });
    expect(where).not.toEqual({});
    expect(where).toHaveProperty('id');
  });

  it('keys a teacher on being the class teacher', () => {
    expect(studentsInReach({ kind: 'OWN_CLASSES', membershipId: 'm-9' })).toEqual({
      enrollments: { some: { classGroup: { classTeacherMembershipId: 'm-9' } } },
    });
  });

  it('excludes a revoked link for a guardian', () => {
    // A court order that removed access must remove the child from the parent's list, and the
    // row stays for the safeguarding record. Both facts live in this one clause.
    expect(studentsInReach({ kind: 'OWN_CHILDREN', guardianId: 'g-a' })).toEqual({
      guardianships: { some: { guardianId: 'g-a', revokedAt: null } },
    });
  });
});
