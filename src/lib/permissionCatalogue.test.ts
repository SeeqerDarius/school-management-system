import { describe, expect, it } from 'vitest';

import { P } from '@/lib/permissions';
import { PERMISSIONS, ROLES } from '../../prisma/seed-data';

/**
 * The permission codes the application checks must be codes the database can actually grant.
 *
 * <p>A typo in a permission constant does not throw. `requirePermission('ACADEMIC_YEAR_MANGE')`
 * compiles, runs, and denies everybody forever — including the head teacher, who then reports
 * that the button does nothing. This test turns that into a build failure.
 */
describe('permission catalogue', () => {
  const catalogue = new Set(PERMISSIONS.map((permission) => permission.code));

  it('has no duplicate codes', () => {
    expect(PERMISSIONS.length).toBe(catalogue.size);
  });

  it('defines every code referenced in application code', () => {
    const referenced = Object.values(P);
    const missing = referenced.filter((code) => !catalogue.has(code));

    expect(
      missing,
      `src/lib/permissions.ts references codes that are not in the catalogue: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('grants roles only permissions that exist', () => {
    const offenders = ROLES.flatMap((role) =>
      role.permissions
        .filter((code) => !catalogue.has(code))
        .map((code) => `${role.code} → ${code}`),
    );

    expect(offenders, `Roles granting unknown permissions: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has no duplicate role codes', () => {
    const codes = ROLES.map((role) => role.code);
    expect(codes.length).toBe(new Set(codes).size);
  });

  /**
   * Segregation of duties.
   *
   * <p>These are not stylistic preferences. One person who can both prepare and approve a
   * payroll run can pay themselves; one person who can both submit and approve a grade can
   * change a result unobserved. The pairs below are the ones this product is expected to keep
   * apart, asserted explicitly so that widening a role is a deliberate act with a failing test
   * to answer for, rather than a line in a large diff.
   */
  it.each([
    ['PAYROLL_OFFICER', 'PAYROLL_PREPARE', 'PAYROLL_APPROVE'],
    ['ACCOUNTANT', 'ACCOUNTING_JOURNAL_CREATE', 'ACCOUNTING_JOURNAL_POST'],
    ['ACCOUNTANT', 'ACCOUNTING_JOURNAL_CREATE', 'ACCOUNTING_JOURNAL_APPROVE'],
    ['REGISTRAR', 'STUDENT_CREATE', 'ACCOUNTING_JOURNAL_POST'],
    ['TEACHER', 'GRADE_SUBMIT', 'GRADE_APPROVE'],
  ])('%s can %s but not %s', (roleCode, allowed, forbidden) => {
    const role = ROLES.find((candidate) => candidate.code === roleCode);
    expect(role, `Role ${roleCode} is missing from the catalogue`).toBeDefined();

    expect(role?.permissions).toContain(allowed);
    expect(role?.permissions).not.toContain(forbidden);
  });

  /**
   * A teacher reaches no payroll administration, no ledger, no health record and no
   * counselling note.
   *
   * <p>Named individually rather than matched by prefix. A teacher legitimately holds
   * HEALTH_ALERT_VIEW — they have to know that a child in their class is severely asthmatic —
   * and PAYSLIP_VIEW_OWN, which is their own payslip. A prefix rule flags both and then gets
   * loosened until it catches nothing, which is how a broad rule becomes no rule.
   */
  it.each([
    'PAYROLL_PREPARE',
    'PAYROLL_APPROVE',
    'PAYROLL_VIEW',
    'ACCOUNTING_VIEW',
    'ACCOUNTING_JOURNAL_CREATE',
    'ACCOUNTING_JOURNAL_POST',
    'HEALTH_RECORD_VIEW',
    'HEALTH_RECORD_MANAGE',
    'COUNSELLING_VIEW',
    'COUNSELLING_MANAGE',
    'STUDENT_VIEW_ALL',
  ])('does not grant a teacher %s', (code) => {
    const teacher = ROLES.find((role) => role.code === 'TEACHER');
    expect(teacher?.permissions).not.toContain(code);
  });

  /** And the grants a teacher must keep, so tightening the role does not break the classroom. */
  it.each(['ATTENDANCE_MARK', 'GRADE_ENTER', 'GRADE_SUBMIT', 'HEALTH_ALERT_VIEW'])(
    'grants a teacher %s',
    (code) => {
      const teacher = ROLES.find((role) => role.code === 'TEACHER');
      expect(teacher?.permissions).toContain(code);
    },
  );
});
