/**
 * Generates V0003__permission_catalogue.sql from the Java permission constants and the
 * system role definitions below.
 *
 * The permission list is read from Permissions.java rather than retyped, so the migration and
 * the code cannot disagree. PermissionCatalogueIT then asserts the two agree in both directions
 * at test time, which catches the case where somebody edits the migration by hand.
 *
 * Run:  node scripts/generate-rbac-seed.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const permissionsJava = resolve(
  repoRoot,
  'services/core-api/src/main/java/io/sankofa/school/identity/authz/Permissions.java',
);
const outputFile = resolve(
  repoRoot,
  'services/core-api/src/main/resources/db/migration/V0003__permission_catalogue.sql',
);

/**
 * Sensitive permissions must be individually assignable and are excluded from any
 * "grant the whole module" convenience in the admin UI (spec 12).
 */
const SENSITIVE = new Set([
  'PERMISSION_ASSIGN', 'ROLE_MANAGE', 'SESSION_REVOKE', 'AUDIT_LOG_VIEW',
  'TENANT_API_KEY_MANAGE', 'TENANT_RETENTION_MANAGE', 'PRIVACY_REQUEST_HANDLE', 'DATA_EXPORT',
  'PAYROLL_APPROVE', 'PAYROLL_POST', 'PAYROLL_STATUTORY_MANAGE', 'PAYSLIP_VIEW_ALL',
  'HR_SALARY_VIEW', 'HR_SALARY_MANAGE',
  'ACCOUNTING_JOURNAL_APPROVE', 'ACCOUNTING_JOURNAL_POST', 'ACCOUNTING_JOURNAL_REVERSE',
  'ACCOUNTING_PERIOD_CLOSE', 'ACCOUNTING_PERIOD_REOPEN',
  'PAYMENT_REFUND', 'PAYMENT_REFUND_APPROVE', 'FEES_WAIVE', 'FEES_DISCOUNT',
  'GRADE_PUBLISH', 'GRADE_AMEND_PUBLISHED',
  'SMS_SEND_BULK', 'ASSET_DISPOSE', 'INVENTORY_ADJUST',
  'PLATFORM_TENANT_SUSPEND', 'PLATFORM_SUPPORT_APPROVE_ACCESS',
]);

/** Permissions touching a child's health, discipline, counselling or whereabouts (spec 58, 88). */
const CHILD_SENSITIVE = new Set([
  'HEALTH_RECORD_VIEW', 'HEALTH_RECORD_MANAGE', 'HEALTH_ALERT_VIEW',
  'DISCIPLINE_VIEW', 'DISCIPLINE_MANAGE',
  'COUNSELLING_VIEW', 'COUNSELLING_MANAGE',
  'STUDENT_DOCUMENT_VIEW', 'STUDENT_DOCUMENT_MANAGE',
  'TRANSPORT_VIEW', 'TRANSPORT_MANAGE',
]);

/** Readable descriptions where the generated one would be clumsy or ambiguous. */
const DESCRIPTIONS = {
  STUDENT_VIEW_OWN_CLASS: 'View students in classes the holder teaches, and no others',
  PAYSLIP_VIEW_OWN: 'View only the holder’s own payslips',
  PAYSLIP_VIEW_ALL: 'View any employee’s payslip',
  GRADE_AMEND_PUBLISHED: 'Amend a published mark, creating an auditable amendment record',
  ACCOUNTING_PERIOD_REOPEN: 'Reopen a closed accounting period, with a recorded reason',
  PLATFORM_SUPPORT_REQUEST_ACCESS: 'Request time-boxed support access to a tenant',
  PLATFORM_SUPPORT_APPROVE_ACCESS: 'Approve a support access request',
  SMS_SEND_BULK: 'Send SMS to a large recipient list, subject to confirmation and quota',
};

// ---------------------------------------------------------------------------------------
// System role templates
//
// Least privilege is the design rule. A permission's ABSENCE from a role is a decision:
// a teacher does not get payroll, accounting, health, discipline or counselling access by
// virtue of being a teacher, and a payroll officer cannot approve the payroll they prepare.
// ---------------------------------------------------------------------------------------
const ROLES = [
  {
    code: 'PLATFORM_SUPER_ADMIN', name: 'Platform Super Admin', scope: 'PLATFORM',
    description:
      'Operates the platform itself. Deliberately holds no permission over a school’s '
      + 'student, health, discipline or academic records; entering a tenant requires a '
      + 'time-boxed, reasoned support grant.',
    permissions: [
      'PLATFORM_TENANT_VIEW', 'PLATFORM_TENANT_PROVISION', 'PLATFORM_TENANT_SUSPEND',
      'PLATFORM_SUBSCRIPTION_MANAGE', 'PLATFORM_HEALTH_VIEW',
      'PLATFORM_SUPPORT_APPROVE_ACCESS', 'PLATFORM_AUDIT_VIEW'],
  },
  {
    code: 'PLATFORM_SUPPORT', name: 'Platform Support', scope: 'PLATFORM',
    description: 'Reads platform health and may request, never self-approve, tenant access.',
    permissions: ['PLATFORM_TENANT_VIEW', 'PLATFORM_HEALTH_VIEW',
      'PLATFORM_SUPPORT_REQUEST_ACCESS'],
  },
  {
    code: 'SCHOOL_OWNER', name: 'School Owner', scope: 'SCHOOL',
    description: 'Full authority within one school, including subscription and role administration.',
    permissions: [
      'TENANT_SETTINGS_VIEW', 'TENANT_SETTINGS_MANAGE', 'TENANT_BRANDING_MANAGE',
      'TENANT_CAMPUS_MANAGE', 'TENANT_INTEGRATION_MANAGE', 'TENANT_API_KEY_MANAGE',
      'TENANT_RETENTION_MANAGE', 'USER_VIEW', 'USER_INVITE', 'USER_SUSPEND', 'ROLE_VIEW',
      'ROLE_MANAGE', 'PERMISSION_ASSIGN', 'SESSION_REVOKE', 'AUDIT_LOG_VIEW',
      'DASHBOARD_EXECUTIVE_VIEW', 'ANALYTICS_FINANCE_VIEW', 'ANALYTICS_ACADEMIC_VIEW',
      'STUDENT_VIEW', 'HR_STAFF_VIEW', 'ACCOUNTING_VIEW', 'ACCOUNTING_REPORT_VIEW',
      'FEES_VIEW', 'PAYROLL_VIEW', 'DATA_EXPORT', 'PRIVACY_REQUEST_HANDLE'],
  },
  {
    code: 'SCHOOL_ADMIN', name: 'School Administrator', scope: 'SCHOOL',
    description: 'Day-to-day administration of people, structure and settings. '
      + 'Not finance approval, not payroll approval.',
    permissions: [
      'TENANT_SETTINGS_VIEW', 'TENANT_SETTINGS_MANAGE', 'TENANT_BRANDING_MANAGE',
      'TENANT_CAMPUS_MANAGE', 'USER_VIEW', 'USER_INVITE', 'USER_SUSPEND', 'ROLE_VIEW',
      'ACADEMIC_YEAR_VIEW', 'ACADEMIC_YEAR_MANAGE', 'CLASS_VIEW', 'CLASS_MANAGE',
      'SUBJECT_VIEW', 'SUBJECT_MANAGE', 'TEACHING_ASSIGNMENT_MANAGE', 'TIMETABLE_VIEW',
      'TIMETABLE_MANAGE', 'TIMETABLE_SUBSTITUTE', 'STUDENT_VIEW', 'STUDENT_CREATE',
      'STUDENT_UPDATE', 'STUDENT_ARCHIVE', 'STUDENT_PROMOTE', 'GUARDIAN_VIEW',
      'GUARDIAN_MANAGE', 'ADMISSION_APPLICATION_VIEW', 'ADMISSION_APPLICATION_MANAGE',
      'ADMISSION_ENROL', 'ATTENDANCE_VIEW', 'ATTENDANCE_CORRECT', 'ATTENDANCE_LOCK',
      'ASSESSMENT_VIEW', 'ASSESSMENT_MANAGE', 'REPORT_CARD_VIEW', 'REPORT_CARD_GENERATE',
      'ANNOUNCEMENT_VIEW', 'ANNOUNCEMENT_PUBLISH', 'NOTIFICATION_TEMPLATE_MANAGE',
      'NOTIFICATION_SETTINGS_MANAGE', 'NOTIFICATION_FAILURE_VIEW', 'MESSAGE_SEND',
      'DATA_IMPORT', 'DATA_EXPORT', 'AUDIT_LOG_VIEW'],
  },
  {
    code: 'HEADMASTER', name: 'Headmaster / Principal', scope: 'SCHOOL',
    description: 'Executive oversight. Reads widely and approves results; does not post '
      + 'journals or run payroll.',
    permissions: [
      'DASHBOARD_EXECUTIVE_VIEW', 'ANALYTICS_FINANCE_VIEW', 'ANALYTICS_ACADEMIC_VIEW',
      'TENANT_SETTINGS_VIEW', 'ACADEMIC_YEAR_VIEW', 'CLASS_VIEW', 'SUBJECT_VIEW',
      'TIMETABLE_VIEW', 'STUDENT_VIEW', 'GUARDIAN_VIEW', 'ADMISSION_APPLICATION_VIEW',
      'ADMISSION_DECIDE', 'ATTENDANCE_VIEW', 'STAFF_ATTENDANCE_VIEW', 'ASSESSMENT_VIEW',
      'GRADE_REVIEW', 'GRADE_APPROVE', 'GRADE_PUBLISH', 'REPORT_CARD_VIEW',
      'REPORT_CARD_GENERATE', 'TRANSCRIPT_ISSUE', 'FEES_VIEW', 'ACCOUNTING_VIEW',
      'ACCOUNTING_REPORT_VIEW', 'PAYROLL_VIEW', 'HR_STAFF_VIEW', 'HR_LEAVE_APPROVE',
      'DISCIPLINE_VIEW', 'DISCIPLINE_MANAGE', 'ANNOUNCEMENT_VIEW', 'ANNOUNCEMENT_PUBLISH',
      'MESSAGE_SEND', 'AUDIT_LOG_VIEW', 'LIBRARY_VIEW', 'ASSET_VIEW', 'INVENTORY_VIEW'],
  },
  {
    code: 'ACADEMIC_HEAD', name: 'Academic Head', scope: 'SCHOOL',
    description: 'Owns the academic programme and the results pipeline up to approval.',
    permissions: [
      'ACADEMIC_YEAR_VIEW', 'CLASS_VIEW', 'CLASS_MANAGE', 'SUBJECT_VIEW', 'SUBJECT_MANAGE',
      'TEACHING_ASSIGNMENT_MANAGE', 'TIMETABLE_VIEW', 'TIMETABLE_MANAGE',
      'TIMETABLE_SUBSTITUTE', 'STUDENT_VIEW', 'ATTENDANCE_VIEW', 'ASSESSMENT_VIEW',
      'ASSESSMENT_MANAGE', 'GRADE_REVIEW', 'GRADE_APPROVE', 'GRADING_SCHEME_MANAGE',
      'REPORT_CARD_VIEW', 'REPORT_CARD_GENERATE', 'ANALYTICS_ACADEMIC_VIEW',
      'ANNOUNCEMENT_VIEW', 'MESSAGE_SEND'],
  },
  {
    code: 'REGISTRAR', name: 'Registrar', scope: 'SCHOOL',
    description: 'Custodian of the student record and its documents.',
    permissions: [
      'STUDENT_VIEW', 'STUDENT_CREATE', 'STUDENT_UPDATE', 'STUDENT_ARCHIVE',
      'STUDENT_PROMOTE', 'STUDENT_DOCUMENT_VIEW', 'STUDENT_DOCUMENT_MANAGE', 'GUARDIAN_VIEW',
      'GUARDIAN_MANAGE', 'CLASS_VIEW', 'ACADEMIC_YEAR_VIEW', 'ADMISSION_APPLICATION_VIEW',
      'ADMISSION_ENROL', 'REPORT_CARD_VIEW', 'TRANSCRIPT_ISSUE', 'DATA_IMPORT', 'DATA_EXPORT'],
  },
  {
    code: 'ADMISSIONS_OFFICER', name: 'Admissions Officer', scope: 'SCHOOL',
    description: 'Runs the admissions funnel. Cannot decide an offer alone.',
    permissions: [
      'ADMISSION_APPLICATION_VIEW', 'ADMISSION_APPLICATION_MANAGE', 'ADMISSION_ENROL',
      'STUDENT_VIEW', 'GUARDIAN_VIEW', 'GUARDIAN_MANAGE', 'CLASS_VIEW', 'ANNOUNCEMENT_VIEW',
      'MESSAGE_SEND', 'FEES_VIEW'],
  },
  {
    code: 'TEACHER', name: 'Teacher', scope: 'SCHOOL',
    description: 'Teaches assigned classes. Enters and submits marks, and deliberately cannot '
      + 'approve or publish the results they entered.',
    permissions: [
      'TIMETABLE_VIEW', 'CLASS_VIEW', 'SUBJECT_VIEW', 'STUDENT_VIEW_OWN_CLASS',
      'ATTENDANCE_VIEW', 'ATTENDANCE_MARK', 'ASSESSMENT_VIEW', 'GRADE_ENTER',
      'GRADE_EDIT_DRAFT', 'GRADE_SUBMIT', 'REPORT_CARD_VIEW', 'ANNOUNCEMENT_VIEW',
      'MESSAGE_SEND', 'HR_LEAVE_REQUEST', 'PAYSLIP_VIEW_OWN', 'LIBRARY_VIEW',
      'HEALTH_ALERT_VIEW'],
  },
  {
    code: 'CLASS_TEACHER', name: 'Class Teacher', scope: 'SCHOOL',
    description: 'A teacher with pastoral responsibility for one class: adds remarks and sees '
      + 'that class in full.',
    permissions: [
      'TIMETABLE_VIEW', 'CLASS_VIEW', 'SUBJECT_VIEW', 'STUDENT_VIEW_OWN_CLASS',
      'GUARDIAN_VIEW', 'ATTENDANCE_VIEW', 'ATTENDANCE_MARK', 'ASSESSMENT_VIEW',
      'GRADE_ENTER', 'GRADE_EDIT_DRAFT', 'GRADE_SUBMIT', 'REPORT_CARD_VIEW',
      'REPORT_CARD_GENERATE', 'DISCIPLINE_VIEW', 'ANNOUNCEMENT_VIEW', 'MESSAGE_SEND',
      'HR_LEAVE_REQUEST', 'PAYSLIP_VIEW_OWN', 'HEALTH_ALERT_VIEW'],
  },
  {
    code: 'HEAD_OF_DEPARTMENT', name: 'Head of Department', scope: 'SCHOOL',
    description: 'Reviews marks submitted by the department before they reach the academic head.',
    permissions: [
      'TIMETABLE_VIEW', 'CLASS_VIEW', 'SUBJECT_VIEW', 'SUBJECT_MANAGE',
      'TEACHING_ASSIGNMENT_MANAGE', 'STUDENT_VIEW_OWN_CLASS', 'ATTENDANCE_VIEW',
      'ASSESSMENT_VIEW', 'ASSESSMENT_MANAGE', 'GRADE_ENTER', 'GRADE_EDIT_DRAFT',
      'GRADE_SUBMIT', 'GRADE_REVIEW', 'REPORT_CARD_VIEW', 'ANALYTICS_ACADEMIC_VIEW',
      'ANNOUNCEMENT_VIEW', 'MESSAGE_SEND', 'HR_LEAVE_REQUEST', 'HR_LEAVE_APPROVE',
      'PAYSLIP_VIEW_OWN'],
  },
  {
    code: 'BURSAR', name: 'Bursar', scope: 'SCHOOL',
    description: 'Owns fee collection and cash. Records payments and issues receipts; refund '
      + 'approval and journal posting sit with a different holder (maker-checker, spec 134).',
    permissions: [
      'FEES_VIEW', 'FEES_STRUCTURE_MANAGE', 'INVOICE_CREATE', 'INVOICE_CANCEL',
      'FEES_DISCOUNT', 'PAYMENT_RECORD', 'PAYMENT_ALLOCATE', 'PAYMENT_REFUND',
      'RECEIPT_ISSUE', 'RECONCILIATION_VIEW', 'RECONCILIATION_RESOLVE', 'ACCOUNTING_VIEW',
      'ACCOUNTING_REPORT_VIEW', 'ANALYTICS_FINANCE_VIEW', 'STUDENT_VIEW', 'GUARDIAN_VIEW',
      'DATA_EXPORT', 'MESSAGE_SEND'],
  },
  {
    code: 'ACCOUNTANT', name: 'Accountant', scope: 'SCHOOL',
    description: 'Prepares journals and reports. Cannot approve or post their own journal.',
    permissions: [
      'ACCOUNTING_VIEW', 'ACCOUNTING_COA_MANAGE', 'ACCOUNTING_JOURNAL_CREATE',
      'ACCOUNTING_REPORT_VIEW', 'TAX_RULE_MANAGE', 'BUDGET_MANAGE', 'FEES_VIEW',
      'RECONCILIATION_VIEW', 'RECONCILIATION_RESOLVE', 'ANALYTICS_FINANCE_VIEW',
      'ASSET_VIEW', 'INVENTORY_VIEW', 'DATA_EXPORT'],
  },
  {
    code: 'FINANCE_MANAGER', name: 'Finance Manager', scope: 'SCHOOL',
    description: 'The checker in maker-checker: approves and posts journals, approves refunds, '
      + 'closes periods.',
    permissions: [
      'ACCOUNTING_VIEW', 'ACCOUNTING_COA_MANAGE', 'ACCOUNTING_JOURNAL_CREATE',
      'ACCOUNTING_JOURNAL_APPROVE', 'ACCOUNTING_JOURNAL_POST', 'ACCOUNTING_JOURNAL_REVERSE',
      'ACCOUNTING_PERIOD_CLOSE', 'ACCOUNTING_REPORT_VIEW', 'TAX_RULE_MANAGE', 'BUDGET_MANAGE',
      'FEES_VIEW', 'FEES_WAIVE', 'PAYMENT_REFUND_APPROVE', 'RECONCILIATION_VIEW',
      'RECONCILIATION_RESOLVE', 'ANALYTICS_FINANCE_VIEW', 'PAYROLL_VIEW', 'DATA_EXPORT',
      'AUDIT_LOG_VIEW'],
  },
  {
    code: 'HR_MANAGER', name: 'HR Manager', scope: 'SCHOOL',
    description: 'Owns the staff lifecycle. Sees salary data; does not approve payroll.',
    permissions: [
      'HR_STAFF_VIEW', 'HR_STAFF_MANAGE', 'HR_CONTRACT_MANAGE', 'HR_SALARY_VIEW',
      'HR_SALARY_MANAGE', 'HR_LEAVE_APPROVE', 'HR_PERFORMANCE_MANAGE',
      'HR_DISCIPLINARY_MANAGE', 'STAFF_ATTENDANCE_VIEW', 'USER_VIEW', 'USER_INVITE',
      'PAYROLL_VIEW', 'DATA_EXPORT', 'MESSAGE_SEND', 'ANNOUNCEMENT_VIEW'],
  },
  {
    code: 'PAYROLL_OFFICER', name: 'Payroll Officer', scope: 'SCHOOL',
    description: 'Prepares payroll. Approval and posting are deliberately absent (spec 158).',
    permissions: [
      'PAYROLL_VIEW', 'PAYROLL_PREPARE', 'PAYROLL_STATUTORY_MANAGE', 'PAYSLIP_VIEW_ALL',
      'HR_STAFF_VIEW', 'HR_SALARY_VIEW', 'STAFF_ATTENDANCE_VIEW'],
  },
  {
    code: 'LIBRARIAN', name: 'Librarian', scope: 'SCHOOL',
    description: 'Runs the library catalogue and circulation.',
    permissions: ['LIBRARY_VIEW', 'LIBRARY_MANAGE', 'LIBRARY_CIRCULATE', 'STUDENT_VIEW',
      'MESSAGE_SEND', 'ANNOUNCEMENT_VIEW'],
  },
  {
    code: 'NURSE', name: 'Nurse / Health Officer', scope: 'SCHOOL',
    description: 'The only ordinary school role holding health records. Access is audited.',
    permissions: ['HEALTH_RECORD_VIEW', 'HEALTH_RECORD_MANAGE', 'HEALTH_ALERT_VIEW',
      'STUDENT_VIEW', 'GUARDIAN_VIEW', 'MESSAGE_SEND'],
  },
  {
    code: 'COUNSELLOR', name: 'Counsellor', scope: 'SCHOOL',
    description: 'Confidential case work. Counselling notes are not visible to teachers or '
      + 'administrators.',
    permissions: ['COUNSELLING_VIEW', 'COUNSELLING_MANAGE', 'STUDENT_VIEW', 'GUARDIAN_VIEW',
      'DISCIPLINE_VIEW', 'MESSAGE_SEND'],
  },
  {
    code: 'TRANSPORT_MANAGER', name: 'Transport Manager', scope: 'SCHOOL',
    description: 'Routes and vehicles. Pupil address data is restricted to what routing requires.',
    permissions: ['TRANSPORT_VIEW', 'TRANSPORT_MANAGE', 'STUDENT_VIEW', 'GUARDIAN_VIEW',
      'ASSET_VIEW', 'MESSAGE_SEND'],
  },
  {
    code: 'HOSTEL_MANAGER', name: 'Hostel Manager', scope: 'SCHOOL',
    description: 'Boarding allocation and pastoral care in the hostel.',
    permissions: ['HOSTEL_VIEW', 'HOSTEL_MANAGE', 'STUDENT_VIEW', 'GUARDIAN_VIEW',
      'DISCIPLINE_VIEW', 'HEALTH_ALERT_VIEW', 'MESSAGE_SEND'],
  },
  {
    code: 'STOREKEEPER', name: 'Storekeeper', scope: 'SCHOOL',
    description: 'Stock movements. Adjustments require the separate adjust permission.',
    permissions: ['INVENTORY_VIEW', 'INVENTORY_MANAGE', 'PROCUREMENT_RECEIVE', 'ASSET_VIEW'],
  },
  {
    code: 'PROCUREMENT_OFFICER', name: 'Procurement Officer', scope: 'SCHOOL',
    description: 'Raises requisitions and orders. Approval sits with a different holder.',
    permissions: ['PROCUREMENT_REQUEST', 'PROCUREMENT_ORDER', 'PROCUREMENT_RECEIVE',
      'INVENTORY_VIEW', 'ASSET_VIEW', 'ACCOUNTING_VIEW'],
  },
  {
    code: 'ICT_ADMINISTRATOR', name: 'ICT Administrator', scope: 'SCHOOL',
    description: 'Technical administration. Deliberately excludes finance, payroll and health '
      + 'records: administering the system is not a reason to read a child’s medical notes.',
    permissions: [
      'TENANT_SETTINGS_VIEW', 'TENANT_INTEGRATION_MANAGE', 'TENANT_API_KEY_MANAGE',
      'USER_VIEW', 'USER_INVITE', 'SESSION_REVOKE', 'ROLE_VIEW',
      'NOTIFICATION_SETTINGS_MANAGE', 'NOTIFICATION_FAILURE_VIEW', 'AUDIT_LOG_VIEW',
      'DATA_IMPORT'],
  },
  {
    code: 'STUDENT', name: 'Student', scope: 'SCHOOL',
    description: 'Sees their own record only. Row-level filtering to the student is applied on '
      + 'top of these permissions.',
    permissions: ['TIMETABLE_VIEW', 'ASSESSMENT_VIEW', 'REPORT_CARD_VIEW', 'ATTENDANCE_VIEW',
      'LIBRARY_VIEW', 'ANNOUNCEMENT_VIEW', 'MESSAGE_SEND'],
  },
  {
    code: 'GUARDIAN', name: 'Parent / Guardian', scope: 'SCHOOL',
    description: 'Sees linked wards only. Row-level filtering to the guardian link is applied '
      + 'on top of these permissions.',
    permissions: ['TIMETABLE_VIEW', 'ASSESSMENT_VIEW', 'REPORT_CARD_VIEW', 'ATTENDANCE_VIEW',
      'FEES_VIEW', 'LIBRARY_VIEW', 'ANNOUNCEMENT_VIEW', 'MESSAGE_SEND', 'HEALTH_ALERT_VIEW'],
  },
];

// ---------------------------------------------------------------------------------------

const sqlString = (value) => `'${value.replace(/'/g, "''")}'`;

function readPermissions() {
  const source = readFileSync(permissionsJava, 'utf8');
  const permissions = [];
  let module = 'platform';
  for (const line of source.split(/\r?\n/)) {
    const section = line.match(/^\s*\/\/ ---- (.+?) -+$/);
    if (section) {
      module = section[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      continue;
    }
    const constant = line.match(/public static final String [A-Z0-9_]+\s*=\s*"([A-Z0-9_]+)";/);
    if (!constant) continue;
    const code = constant[1];
    const description = DESCRIPTIONS[code]
      ?? code.toLowerCase().split('_').join(' ').replace(/^\w/, (c) => c.toUpperCase());
    permissions.push({
      code,
      module,
      description,
      sensitive: SENSITIVE.has(code),
      childSensitive: CHILD_SENSITIVE.has(code),
    });
  }
  return permissions;
}

function build() {
  const permissions = readPermissions();
  const known = new Set(permissions.map((p) => p.code));

  // A role referencing a permission that does not exist would insert nothing and silently
  // under-grant. Fail the generator instead.
  const unknown = [];
  for (const role of ROLES) {
    for (const code of role.permissions) {
      if (!known.has(code)) unknown.push(`${role.code} -> ${code}`);
    }
  }
  if (unknown.length > 0) {
    throw new Error('Roles reference unknown permissions:\n  ' + unknown.join('\n  '));
  }

  const out = [];
  out.push('-- ==================================================================================');
  out.push('-- V0003 - Permission catalogue and system role templates');
  out.push('--');
  out.push('-- GENERATED by scripts/generate-rbac-seed.mjs from');
  out.push('-- io.sankofa.school.identity.authz.Permissions. Do not hand-edit: regenerate.');
  out.push('--');
  out.push('-- PermissionCatalogueIT asserts the Java constants and these rows agree in BOTH');
  out.push('-- directions, so a permission cannot be referenced in code without existing here,');
  out.push('-- and a row cannot linger here with nothing referencing it.');
  out.push('--');
  out.push('-- Least privilege is the design rule below. A permission being ABSENT from a role is');
  out.push('-- a decision, not an oversight: a teacher does not receive payroll, accounting,');
  out.push('-- health, discipline or counselling access by virtue of being a teacher, and the');
  out.push('-- officer who prepares payroll cannot approve it (spec 134, 158).');
  out.push('-- ==================================================================================');
  out.push('');
  out.push(`-- ${permissions.length} permissions; `
    + `${permissions.filter((p) => p.sensitive).length} sensitive, `
    + `${permissions.filter((p) => p.childSensitive).length} child-sensitive.`);
  out.push('INSERT INTO identity.permission '
    + '(id, code, module, description, is_sensitive, is_child_sensitive) VALUES');
  out.push(permissions.map((p) =>
    `    (gen_random_uuid(), ${sqlString(p.code)}, ${sqlString(p.module)}, `
    + `${sqlString(p.description)}, ${p.sensitive}, ${p.childSensitive})`).join(',\n'));
  out.push('ON CONFLICT (code) DO NOTHING;');
  out.push('');
  out.push(`-- ${ROLES.length} system role templates. tenant_id IS NULL marks a template that every`);
  out.push('-- tenant may use. A school can copy one into its own editable role; it cannot alter');
  out.push('-- the template itself.');
  out.push('INSERT INTO identity.role '
    + '(id, tenant_id, code, name, description, scope, is_system, is_assignable) VALUES');
  out.push(ROLES.map((r) =>
    `    (gen_random_uuid(), NULL, ${sqlString(r.code)}, ${sqlString(r.name)}, `
    + `${sqlString(r.description)}, ${sqlString(r.scope)}, true, true)`).join(',\n'));
  out.push('ON CONFLICT DO NOTHING;');
  out.push('');

  let grants = 0;
  for (const role of ROLES) {
    const codes = [...new Set(role.permissions)].sort();
    grants += codes.length;
    out.push(`-- ${role.name}: ${codes.length} permissions`);
    out.push('INSERT INTO identity.role_permission (role_id, permission_id)');
    out.push('SELECT r.id, p.id');
    out.push('  FROM identity.role r');
    out.push('  JOIN identity.permission p ON p.code IN (');
    out.push('        ' + codes.map(sqlString).join(',\n        '));
    out.push('       )');
    out.push(` WHERE r.code = ${sqlString(role.code)} AND r.tenant_id IS NULL`);
    out.push('ON CONFLICT DO NOTHING;');
    out.push('');
  }

  writeFileSync(outputFile, out.join('\n'), 'utf8');
  process.stderr.write(
    `Wrote ${outputFile}\n`
    + `  permissions: ${permissions.length}\n`
    + `  roles:       ${ROLES.length}\n`
    + `  grants:      ${grants}\n`);
}

build();
