/**
 * Permission codes referenced in application code.
 *
 * <p>Constants rather than string literals, so a typo is a compile error instead of a
 * permanently-denied endpoint that nobody can explain. The full catalogue of 142 lives in
 * `prisma/seed-data.ts`; these are the ones features currently check.
 *
 * <p>`permissionCatalogue.test.ts` asserts every constant here exists in the seeded catalogue,
 * so a code cannot be referenced without also being grantable.
 */
export const P = {
  // School settings
  TENANT_SETTINGS_VIEW: 'TENANT_SETTINGS_VIEW',
  TENANT_SETTINGS_MANAGE: 'TENANT_SETTINGS_MANAGE',
  TENANT_BRANDING_MANAGE: 'TENANT_BRANDING_MANAGE',
  TENANT_CAMPUS_MANAGE: 'TENANT_CAMPUS_MANAGE',

  // Academic calendar
  ACADEMIC_YEAR_VIEW: 'ACADEMIC_YEAR_VIEW',
  ACADEMIC_YEAR_MANAGE: 'ACADEMIC_YEAR_MANAGE',

  // Audit
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW',
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];
