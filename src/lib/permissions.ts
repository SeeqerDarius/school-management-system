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

  // Students
  STUDENT_READ: 'STUDENT_READ',
  STUDENT_CREATE: 'STUDENT_CREATE',
  STUDENT_UPDATE: 'STUDENT_UPDATE',
  STUDENT_DELETE: 'STUDENT_DELETE',
  STUDENT_STATUS_CHANGE: 'STUDENT_STATUS_CHANGE',

  // Guardians
  GUARDIAN_READ: 'GUARDIAN_READ',
  GUARDIAN_CREATE: 'GUARDIAN_CREATE',
  GUARDIAN_UPDATE: 'GUARDIAN_UPDATE',
  GUARDIAN_DELETE: 'GUARDIAN_DELETE',

  // Enrolment
  ENROLMENT_READ: 'ENROLMENT_READ',
  ENROLMENT_CREATE: 'ENROLMENT_CREATE',
  ENROLMENT_UPDATE: 'ENROLMENT_UPDATE',
  ENROLMENT_DELETE: 'ENROLMENT_DELETE',
  ENROLMENT_STATUS_CHANGE: 'ENROLMENT_STATUS_CHANGE',
  // How far a roster reaches. Both are already in the seeded catalogue and already
  // correctly assigned — STUDENT_VIEW to the people who run the school,
  // STUDENT_VIEW_OWN_CLASS to the people who stand in front of a class. They were simply
  // never referenced from code, so nothing read the line the catalogue was drawing.
  STUDENT_VIEW: 'STUDENT_VIEW',
  STUDENT_VIEW_OWN_CLASS: 'STUDENT_VIEW_OWN_CLASS',
  GUARDIAN_VIEW: 'GUARDIAN_VIEW',

  // Medical. The catalogue already separates the flag from the record, which is exactly the
  // distinction DATA_PRIVACY §4 asks for: a teacher learns there is an alert and fetches the
  // nurse; the nurse reads what it says.
  HEALTH_ALERT_VIEW: 'HEALTH_ALERT_VIEW',
  HEALTH_RECORD_VIEW: 'HEALTH_RECORD_VIEW',

  // Classes and the daily register. All already in the seeded catalogue.
  CLASS_VIEW: 'CLASS_VIEW',
  CLASS_MANAGE: 'CLASS_MANAGE',
  ADMISSION_ENROL: 'ADMISSION_ENROL',
  ATTENDANCE_VIEW: 'ATTENDANCE_VIEW',
  ATTENDANCE_MARK: 'ATTENDANCE_MARK',
  ATTENDANCE_CORRECT: 'ATTENDANCE_CORRECT',
  ATTENDANCE_LOCK: 'ATTENDANCE_LOCK',

  // People and access
  USER_VIEW: 'USER_VIEW',
  USER_INVITE: 'USER_INVITE',

  // Audit
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW',
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];
