package io.sankofa.school.identity.authz;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Set;
import java.util.TreeSet;

/**
 * The permission catalogue.
 *
 * <p>Every capability in the system has a code here, and {@code V0003__permission_catalogue.sql}
 * seeds exactly the same set into {@code identity.permission}. {@code PermissionCatalogueIT}
 * asserts the two agree in both directions, so a permission cannot be referenced in code without
 * existing in the database, and a row cannot linger in the database with nothing referencing it.
 *
 * <p>Naming: {@code MODULE_NOUN_VERB}. Codes are permanent — renaming one breaks every role
 * assignment that references it, so a mistake is corrected by adding the right code and
 * deprecating the wrong one, never by editing in place.
 *
 * <p><b>Sensitive</b> permissions (payroll approval, refunds, journal posting, permission
 * management, health and counselling records) are flagged in the seed and must be assigned
 * individually rather than swept in by a "give them everything in this module" convenience (§12).
 */
public final class Permissions {

    private Permissions() {
    }

    // ---- Platform ---------------------------------------------------------------------
    public static final String PLATFORM_TENANT_VIEW = "PLATFORM_TENANT_VIEW";
    public static final String PLATFORM_TENANT_PROVISION = "PLATFORM_TENANT_PROVISION";
    public static final String PLATFORM_TENANT_SUSPEND = "PLATFORM_TENANT_SUSPEND";
    public static final String PLATFORM_SUBSCRIPTION_MANAGE = "PLATFORM_SUBSCRIPTION_MANAGE";
    public static final String PLATFORM_HEALTH_VIEW = "PLATFORM_HEALTH_VIEW";
    public static final String PLATFORM_SUPPORT_REQUEST_ACCESS = "PLATFORM_SUPPORT_REQUEST_ACCESS";
    public static final String PLATFORM_SUPPORT_APPROVE_ACCESS = "PLATFORM_SUPPORT_APPROVE_ACCESS";
    public static final String PLATFORM_AUDIT_VIEW = "PLATFORM_AUDIT_VIEW";

    // ---- Tenant settings --------------------------------------------------------------
    public static final String TENANT_SETTINGS_VIEW = "TENANT_SETTINGS_VIEW";
    public static final String TENANT_SETTINGS_MANAGE = "TENANT_SETTINGS_MANAGE";
    public static final String TENANT_BRANDING_MANAGE = "TENANT_BRANDING_MANAGE";
    public static final String TENANT_CAMPUS_MANAGE = "TENANT_CAMPUS_MANAGE";
    public static final String TENANT_INTEGRATION_MANAGE = "TENANT_INTEGRATION_MANAGE";
    public static final String TENANT_API_KEY_MANAGE = "TENANT_API_KEY_MANAGE";
    public static final String TENANT_RETENTION_MANAGE = "TENANT_RETENTION_MANAGE";

    // ---- Identity and access ----------------------------------------------------------
    public static final String USER_VIEW = "USER_VIEW";
    public static final String USER_INVITE = "USER_INVITE";
    public static final String USER_SUSPEND = "USER_SUSPEND";
    public static final String ROLE_VIEW = "ROLE_VIEW";
    public static final String ROLE_MANAGE = "ROLE_MANAGE";
    public static final String PERMISSION_ASSIGN = "PERMISSION_ASSIGN";
    public static final String SESSION_REVOKE = "SESSION_REVOKE";

    // ---- Academic structure -----------------------------------------------------------
    public static final String ACADEMIC_YEAR_VIEW = "ACADEMIC_YEAR_VIEW";
    public static final String ACADEMIC_YEAR_MANAGE = "ACADEMIC_YEAR_MANAGE";
    public static final String CLASS_VIEW = "CLASS_VIEW";
    public static final String CLASS_MANAGE = "CLASS_MANAGE";
    public static final String SUBJECT_VIEW = "SUBJECT_VIEW";
    public static final String SUBJECT_MANAGE = "SUBJECT_MANAGE";
    public static final String TEACHING_ASSIGNMENT_MANAGE = "TEACHING_ASSIGNMENT_MANAGE";
    public static final String TIMETABLE_VIEW = "TIMETABLE_VIEW";
    public static final String TIMETABLE_MANAGE = "TIMETABLE_MANAGE";
    public static final String TIMETABLE_SUBSTITUTE = "TIMETABLE_SUBSTITUTE";

    // ---- Students ---------------------------------------------------------------------
    public static final String STUDENT_VIEW = "STUDENT_VIEW";
    public static final String STUDENT_VIEW_OWN_CLASS = "STUDENT_VIEW_OWN_CLASS";
    public static final String STUDENT_CREATE = "STUDENT_CREATE";
    public static final String STUDENT_UPDATE = "STUDENT_UPDATE";
    public static final String STUDENT_ARCHIVE = "STUDENT_ARCHIVE";
    public static final String STUDENT_PROMOTE = "STUDENT_PROMOTE";
    public static final String STUDENT_DOCUMENT_VIEW = "STUDENT_DOCUMENT_VIEW";
    public static final String STUDENT_DOCUMENT_MANAGE = "STUDENT_DOCUMENT_MANAGE";
    public static final String GUARDIAN_VIEW = "GUARDIAN_VIEW";
    public static final String GUARDIAN_MANAGE = "GUARDIAN_MANAGE";

    // ---- Admissions -------------------------------------------------------------------
    public static final String ADMISSION_APPLICATION_VIEW = "ADMISSION_APPLICATION_VIEW";
    public static final String ADMISSION_APPLICATION_MANAGE = "ADMISSION_APPLICATION_MANAGE";
    public static final String ADMISSION_DECIDE = "ADMISSION_DECIDE";
    public static final String ADMISSION_ENROL = "ADMISSION_ENROL";

    // ---- Attendance -------------------------------------------------------------------
    public static final String ATTENDANCE_VIEW = "ATTENDANCE_VIEW";
    public static final String ATTENDANCE_MARK = "ATTENDANCE_MARK";
    public static final String ATTENDANCE_CORRECT = "ATTENDANCE_CORRECT";
    public static final String ATTENDANCE_LOCK = "ATTENDANCE_LOCK";
    public static final String STAFF_ATTENDANCE_VIEW = "STAFF_ATTENDANCE_VIEW";

    // ---- Assessment and grading -------------------------------------------------------
    public static final String ASSESSMENT_VIEW = "ASSESSMENT_VIEW";
    public static final String ASSESSMENT_MANAGE = "ASSESSMENT_MANAGE";
    public static final String GRADE_ENTER = "GRADE_ENTER";
    public static final String GRADE_EDIT_DRAFT = "GRADE_EDIT_DRAFT";
    public static final String GRADE_SUBMIT = "GRADE_SUBMIT";
    public static final String GRADE_REVIEW = "GRADE_REVIEW";
    public static final String GRADE_APPROVE = "GRADE_APPROVE";
    public static final String GRADE_PUBLISH = "GRADE_PUBLISH";
    public static final String GRADE_AMEND_PUBLISHED = "GRADE_AMEND_PUBLISHED";
    public static final String GRADING_SCHEME_MANAGE = "GRADING_SCHEME_MANAGE";
    public static final String REPORT_CARD_VIEW = "REPORT_CARD_VIEW";
    public static final String REPORT_CARD_GENERATE = "REPORT_CARD_GENERATE";
    public static final String TRANSCRIPT_ISSUE = "TRANSCRIPT_ISSUE";

    // ---- Fees and payments ------------------------------------------------------------
    public static final String FEES_VIEW = "FEES_VIEW";
    public static final String FEES_STRUCTURE_MANAGE = "FEES_STRUCTURE_MANAGE";
    public static final String INVOICE_CREATE = "INVOICE_CREATE";
    public static final String INVOICE_CANCEL = "INVOICE_CANCEL";
    public static final String FEES_DISCOUNT = "FEES_DISCOUNT";
    public static final String FEES_WAIVE = "FEES_WAIVE";
    public static final String PAYMENT_RECORD = "PAYMENT_RECORD";
    public static final String PAYMENT_ALLOCATE = "PAYMENT_ALLOCATE";
    public static final String PAYMENT_REFUND = "PAYMENT_REFUND";
    public static final String PAYMENT_REFUND_APPROVE = "PAYMENT_REFUND_APPROVE";
    public static final String RECEIPT_ISSUE = "RECEIPT_ISSUE";
    public static final String RECONCILIATION_VIEW = "RECONCILIATION_VIEW";
    public static final String RECONCILIATION_RESOLVE = "RECONCILIATION_RESOLVE";

    // ---- Accounting -------------------------------------------------------------------
    public static final String ACCOUNTING_VIEW = "ACCOUNTING_VIEW";
    public static final String ACCOUNTING_COA_MANAGE = "ACCOUNTING_COA_MANAGE";
    public static final String ACCOUNTING_JOURNAL_CREATE = "ACCOUNTING_JOURNAL_CREATE";
    public static final String ACCOUNTING_JOURNAL_APPROVE = "ACCOUNTING_JOURNAL_APPROVE";
    public static final String ACCOUNTING_JOURNAL_POST = "ACCOUNTING_JOURNAL_POST";
    public static final String ACCOUNTING_JOURNAL_REVERSE = "ACCOUNTING_JOURNAL_REVERSE";
    public static final String ACCOUNTING_PERIOD_CLOSE = "ACCOUNTING_PERIOD_CLOSE";
    public static final String ACCOUNTING_PERIOD_REOPEN = "ACCOUNTING_PERIOD_REOPEN";
    public static final String ACCOUNTING_REPORT_VIEW = "ACCOUNTING_REPORT_VIEW";
    public static final String TAX_RULE_MANAGE = "TAX_RULE_MANAGE";
    public static final String BUDGET_MANAGE = "BUDGET_MANAGE";

    // ---- HR ---------------------------------------------------------------------------
    public static final String HR_STAFF_VIEW = "HR_STAFF_VIEW";
    public static final String HR_STAFF_MANAGE = "HR_STAFF_MANAGE";
    public static final String HR_CONTRACT_MANAGE = "HR_CONTRACT_MANAGE";
    public static final String HR_SALARY_VIEW = "HR_SALARY_VIEW";
    public static final String HR_SALARY_MANAGE = "HR_SALARY_MANAGE";
    public static final String HR_LEAVE_REQUEST = "HR_LEAVE_REQUEST";
    public static final String HR_LEAVE_APPROVE = "HR_LEAVE_APPROVE";
    public static final String HR_PERFORMANCE_MANAGE = "HR_PERFORMANCE_MANAGE";
    public static final String HR_DISCIPLINARY_MANAGE = "HR_DISCIPLINARY_MANAGE";

    // ---- Payroll ----------------------------------------------------------------------
    public static final String PAYROLL_VIEW = "PAYROLL_VIEW";
    public static final String PAYROLL_PREPARE = "PAYROLL_PREPARE";
    public static final String PAYROLL_APPROVE = "PAYROLL_APPROVE";
    public static final String PAYROLL_POST = "PAYROLL_POST";
    public static final String PAYROLL_STATUTORY_MANAGE = "PAYROLL_STATUTORY_MANAGE";
    public static final String PAYSLIP_VIEW_OWN = "PAYSLIP_VIEW_OWN";
    public static final String PAYSLIP_VIEW_ALL = "PAYSLIP_VIEW_ALL";

    // ---- Library, inventory, procurement, assets ---------------------------------------
    public static final String LIBRARY_VIEW = "LIBRARY_VIEW";
    public static final String LIBRARY_MANAGE = "LIBRARY_MANAGE";
    public static final String LIBRARY_CIRCULATE = "LIBRARY_CIRCULATE";
    public static final String INVENTORY_VIEW = "INVENTORY_VIEW";
    public static final String INVENTORY_MANAGE = "INVENTORY_MANAGE";
    public static final String INVENTORY_ADJUST = "INVENTORY_ADJUST";
    public static final String PROCUREMENT_REQUEST = "PROCUREMENT_REQUEST";
    public static final String PROCUREMENT_APPROVE = "PROCUREMENT_APPROVE";
    public static final String PROCUREMENT_ORDER = "PROCUREMENT_ORDER";
    public static final String PROCUREMENT_RECEIVE = "PROCUREMENT_RECEIVE";
    public static final String ASSET_VIEW = "ASSET_VIEW";
    public static final String ASSET_MANAGE = "ASSET_MANAGE";
    public static final String ASSET_DISPOSE = "ASSET_DISPOSE";

    // ---- Operations -------------------------------------------------------------------
    public static final String TRANSPORT_VIEW = "TRANSPORT_VIEW";
    public static final String TRANSPORT_MANAGE = "TRANSPORT_MANAGE";
    public static final String HOSTEL_VIEW = "HOSTEL_VIEW";
    public static final String HOSTEL_MANAGE = "HOSTEL_MANAGE";

    // ---- Restricted personal records ---------------------------------------------------
    // Deliberately separate from the ordinary teaching permissions. An ordinary class
    // teacher does not receive these by default (§58, §60, §88).
    public static final String HEALTH_RECORD_VIEW = "HEALTH_RECORD_VIEW";
    public static final String HEALTH_RECORD_MANAGE = "HEALTH_RECORD_MANAGE";
    public static final String HEALTH_ALERT_VIEW = "HEALTH_ALERT_VIEW";
    public static final String DISCIPLINE_VIEW = "DISCIPLINE_VIEW";
    public static final String DISCIPLINE_MANAGE = "DISCIPLINE_MANAGE";
    public static final String COUNSELLING_VIEW = "COUNSELLING_VIEW";
    public static final String COUNSELLING_MANAGE = "COUNSELLING_MANAGE";

    // ---- Communications ---------------------------------------------------------------
    public static final String ANNOUNCEMENT_VIEW = "ANNOUNCEMENT_VIEW";
    public static final String ANNOUNCEMENT_PUBLISH = "ANNOUNCEMENT_PUBLISH";
    public static final String NOTIFICATION_TEMPLATE_MANAGE = "NOTIFICATION_TEMPLATE_MANAGE";
    public static final String NOTIFICATION_SETTINGS_MANAGE = "NOTIFICATION_SETTINGS_MANAGE";
    public static final String NOTIFICATION_FAILURE_VIEW = "NOTIFICATION_FAILURE_VIEW";
    public static final String SMS_SEND_BULK = "SMS_SEND_BULK";
    public static final String MESSAGE_SEND = "MESSAGE_SEND";

    // ---- Analytics, audit, data --------------------------------------------------------
    public static final String DASHBOARD_EXECUTIVE_VIEW = "DASHBOARD_EXECUTIVE_VIEW";
    public static final String ANALYTICS_FINANCE_VIEW = "ANALYTICS_FINANCE_VIEW";
    public static final String ANALYTICS_ACADEMIC_VIEW = "ANALYTICS_ACADEMIC_VIEW";
    public static final String AUDIT_LOG_VIEW = "AUDIT_LOG_VIEW";
    public static final String DATA_EXPORT = "DATA_EXPORT";
    public static final String DATA_IMPORT = "DATA_IMPORT";
    public static final String PRIVACY_REQUEST_HANDLE = "PRIVACY_REQUEST_HANDLE";

    /**
     * Every declared permission code, discovered reflectively.
     *
     * <p>Used by {@code PermissionCatalogueIT} to prove the code and the database seed agree.
     * Reflection here is deliberate: a hand-maintained second list would drift on the first day
     * somebody added a constant and forgot the list.
     */
    public static Set<String> all() {
        Set<String> codes = new TreeSet<>();
        for (Field field : Permissions.class.getDeclaredFields()) {
            int mods = field.getModifiers();
            if (Modifier.isPublic(mods) && Modifier.isStatic(mods) && Modifier.isFinal(mods)
                    && field.getType() == String.class) {
                try {
                    codes.add((String) field.get(null));
                } catch (IllegalAccessException e) {
                    throw new IllegalStateException(
                            "Could not read permission constant " + field.getName(), e);
                }
            }
        }
        return Set.copyOf(codes);
    }
}
