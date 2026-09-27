import { describe, expect, it } from 'vitest';

import {
  feeReach,
  mayShowBalanceAlongsideAChild,
  outstandingOf,
  settlementOf,
  type FeeViewer,
} from '@/lib/fee-visibility';
import { P } from '@/lib/permissions';

/**
 * Who may see what a family owes.
 *
 * <p>Written from the deny side. `DATA_PRIVACY.md` §4 names two specific ways to get fee
 * visibility wrong, and both of them look like helpfulness at the time — so the tests that
 * matter are the ones asserting that a reasonable-seeming person is refused.
 */

const viewer = (permissions: string[], overrides: Partial<FeeViewer> = {}): FeeViewer => ({
  principalType: 'STAFF',
  principalId: null,
  permissions: new Set(permissions),
  ...overrides,
});

const CLOSED = { studentsSeeFeeBalance: false };
const OPEN = { studentsSeeFeeBalance: true };

describe('staff', () => {
  it('gives a bursar every child’s ledger', () => {
    expect(feeReach(viewer([P.FEES_VIEW, P.STUDENT_VIEW]), CLOSED)).toEqual({ kind: 'ALL' });
  });

  it('gives a class teacher NOTHING — §188.1, the convenience join', () => {
    // A class teacher holds STUDENT_VIEW_OWN_CLASS, GUARDIAN_VIEW and ATTENDANCE_MARK. They
    // see the child's record, their guardians and their attendance. They must never see what
    // the family owes: "the class teacher must not be the person who knows which family has
    // not paid".
    const classTeacher = viewer([
      P.STUDENT_VIEW_OWN_CLASS,
      P.GUARDIAN_VIEW,
      P.ATTENDANCE_MARK,
      P.ATTENDANCE_VIEW,
    ]);

    expect(feeReach(classTeacher, CLOSED)).toEqual({ kind: 'NONE' });
    expect(mayShowBalanceAlongsideAChild(classTeacher, CLOSED)).toBe(false);
  });

  it('gives nothing to somebody with every student permission but not FEES_VIEW', () => {
    expect(
      feeReach(viewer([P.STUDENT_VIEW, P.STUDENT_CREATE, P.STUDENT_UPDATE, P.GUARDIAN_VIEW]), CLOSED),
    ).toEqual({ kind: 'NONE' });
  });
});

describe('a guardian', () => {
  it('reaches their own children and no others', () => {
    expect(
      feeReach(
        viewer([P.FEES_VIEW], { principalType: 'GUARDIAN', principalId: 'guardian-a' }),
        CLOSED,
      ),
    ).toEqual({ kind: 'OWN_CHILDREN', guardianId: 'guardian-a' });
  });

  it('reaches nothing when the membership has no guardian row', () => {
    expect(
      feeReach(viewer([P.FEES_VIEW], { principalType: 'GUARDIAN', principalId: null }), CLOSED),
    ).toEqual({ kind: 'NONE' });
  });

  it('is not widened by holding staff permissions', () => {
    expect(
      feeReach(
        viewer([P.FEES_VIEW, P.STUDENT_VIEW], {
          principalType: 'GUARDIAN',
          principalId: 'guardian-a',
        }),
        CLOSED,
      ),
    ).toEqual({ kind: 'OWN_CHILDREN', guardianId: 'guardian-a' });
  });
});

describe('a student — §187, the second gate', () => {
  const student = viewer([P.FEES_VIEW], { principalType: 'STUDENT', principalId: 'student-1' });

  it('sees NOTHING by default, even holding FEES_VIEW', () => {
    // The assertion this module exists for. "A child should not be told the family owes
    // money." A school that grants the permission by accident has not thereby told a
    // fifteen-year-old their family is in arrears — the tenant setting is a second gate.
    expect(feeReach(student, CLOSED)).toEqual({ kind: 'NONE' });
  });

  it('sees their own ledger once the school switches it on', () => {
    expect(feeReach(student, OPEN)).toEqual({ kind: 'OWN', studentId: 'student-1' });
  });

  it('still sees nothing with the setting on but no FEES_VIEW', () => {
    // Both gates, in both orders.
    expect(
      feeReach(viewer([], { principalType: 'STUDENT', principalId: 'student-1' }), OPEN),
    ).toEqual({ kind: 'NONE' });
  });

  it('sees nothing when the membership has no student row', () => {
    expect(
      feeReach(viewer([P.FEES_VIEW], { principalType: 'STUDENT', principalId: null }), OPEN),
    ).toEqual({ kind: 'NONE' });
  });
});

describe('how an invoice stands', () => {
  it('is UNPAID when nothing has been settled', () => {
    expect(settlementOf('ISSUED', '1200.00', '0')).toBe('UNPAID');
  });

  it('is PART_PAID after a partial payment', () => {
    expect(settlementOf('ISSUED', '1200.00', '500.00')).toBe('PART_PAID');
  });

  it('is PAID on the exact amount, not a pesewa before it', () => {
    expect(settlementOf('ISSUED', '1200.00', '1199.99')).toBe('PART_PAID');
    expect(settlementOf('ISSUED', '1200.00', '1200.00')).toBe('PAID');
    // Scale must not decide the answer: 1200 and 1200.0000 are the same money.
    expect(settlementOf('ISSUED', '1200.0000', '1200')).toBe('PAID');
  });

  it('reports a draft and a cancellation as themselves, not as unpaid', () => {
    expect(settlementOf('DRAFT', '1200.00', '0')).toBe('DRAFT');
    expect(settlementOf('CANCELLED', '1200.00', '0')).toBe('CANCELLED');
  });

  it('never reports a negative outstanding balance', () => {
    expect(outstandingOf('1200.00', '1200.00')).toBe('0.0000');
    expect(outstandingOf('1200.00', '500.00')).toBe('700.0000');
    // Defensive: the database refuses over-settlement, so this should be unreachable — and a
    // screen that ever did show "-₵50 owed" would be worse than one that showed nothing.
    expect(outstandingOf('1200.00', '1500.00')).toBe('0.0000');
  });
});
