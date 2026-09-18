package io.sankofa.school.identity.authz;

import io.sankofa.school.testsupport.TestDatabase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the Java permission constants and the seeded catalogue agree — in both directions.
 *
 * <p>{@code V0003} is generated from {@link Permissions}, so the two start in agreement. This
 * test is what keeps them there: somebody will eventually hand-edit the migration, or add a
 * constant without regenerating, and the resulting failure is quiet in both directions.
 *
 * <ul>
 *   <li>A constant with no row means {@code @RequiresPermission} names something no role can
 *       ever hold, so the endpoint is permanently unreachable — a 403 nobody can explain.</li>
 *   <li>A row with no constant means a permission is assignable in the admin UI and grants
 *       nothing, which is worse: an administrator believes access has been given.</li>
 * </ul>
 */
class PermissionCatalogueIT {

    @Test
    @DisplayName("every Java permission constant exists in the database")
    void everyConstantIsSeeded() throws SQLException {
        Set<String> inCode = Permissions.all();
        Set<String> inDatabase = seededCodes();

        Set<String> missing = new TreeSet<>(inCode);
        missing.removeAll(inDatabase);

        assertThat(missing)
                .as("These permissions are referenced in Java but not seeded, so no role can "
                        + "hold them and any endpoint guarding on one is unreachable. "
                        + "Run: node scripts/generate-rbac-seed.mjs")
                .isEmpty();
    }

    @Test
    @DisplayName("every seeded permission is referenced by a Java constant")
    void everySeededPermissionIsUsed() throws SQLException {
        Set<String> inCode = Permissions.all();
        Set<String> inDatabase = seededCodes();

        Set<String> orphaned = new TreeSet<>(inDatabase);
        orphaned.removeAll(inCode);

        assertThat(orphaned)
                .as("These permissions exist in the database but nothing in Java references "
                        + "them. They would appear assignable in the admin UI and grant "
                        + "nothing, which misleads whoever assigns one.")
                .isEmpty();
    }

    @Test
    @DisplayName("the catalogue is not empty and every code is well formed")
    void catalogueIsPopulatedAndWellFormed() throws SQLException {
        Set<String> codes = seededCodes();

        // Guards against a vacuous pass: two empty sets are also "in agreement".
        assertThat(codes).hasSizeGreaterThan(100);
        assertThat(codes).allSatisfy(code ->
                assertThat(code).matches("^[A-Z][A-Z0-9_]{2,79}$"));
    }

    @Test
    @DisplayName("restricted personal-record permissions are flagged child-sensitive")
    void childSensitivePermissionsAreFlagged() throws SQLException {
        Map<String, Boolean> flags = childSensitiveFlags();

        // These gate a child's medical notes, discipline history, counselling record and
        // transport route. The flag is what stops them being swept into a role by a
        // "grant everything in this module" convenience (spec 58, 88).
        for (String code : Set.of(
                Permissions.HEALTH_RECORD_VIEW, Permissions.HEALTH_RECORD_MANAGE,
                Permissions.DISCIPLINE_VIEW, Permissions.DISCIPLINE_MANAGE,
                Permissions.COUNSELLING_VIEW, Permissions.COUNSELLING_MANAGE,
                Permissions.TRANSPORT_VIEW)) {
            assertThat(flags.get(code))
                    .as("%s touches a child's restricted record and must be flagged "
                            + "child-sensitive", code)
                    .isTrue();
        }
    }

    @Test
    @DisplayName("a teacher role does not carry payroll, accounting or health permissions")
    void teacherRoleIsLeastPrivilege() throws SQLException {
        Set<String> teacherPermissions = permissionsOfSystemRole("TEACHER");

        assertThat(teacherPermissions)
                .as("A teacher must be able to do their job")
                .contains(Permissions.ATTENDANCE_MARK, Permissions.GRADE_ENTER,
                        Permissions.GRADE_SUBMIT);

        assertThat(teacherPermissions)
                .as("Teaching is not a reason to reach payroll, the ledger, a child's medical "
                        + "notes or counselling records")
                .doesNotContain(
                        Permissions.PAYROLL_APPROVE, Permissions.PAYROLL_POST,
                        Permissions.PAYSLIP_VIEW_ALL, Permissions.HR_SALARY_VIEW,
                        Permissions.ACCOUNTING_JOURNAL_POST, Permissions.ACCOUNTING_PERIOD_CLOSE,
                        Permissions.HEALTH_RECORD_VIEW, Permissions.COUNSELLING_VIEW,
                        Permissions.GRADE_APPROVE, Permissions.GRADE_PUBLISH,
                        Permissions.PERMISSION_ASSIGN);
    }

    @Test
    @DisplayName("the payroll officer who prepares a run cannot approve or post it")
    void payrollSegregationOfDutiesHolds() throws SQLException {
        Set<String> payrollOfficer = permissionsOfSystemRole("PAYROLL_OFFICER");

        assertThat(payrollOfficer).contains(Permissions.PAYROLL_PREPARE);
        assertThat(payrollOfficer)
                .as("Maker and checker must be different people (spec 134, 158). If one role "
                        + "holds both, the control is decorative.")
                .doesNotContain(Permissions.PAYROLL_APPROVE, Permissions.PAYROLL_POST);
    }

    @Test
    @DisplayName("the accountant who raises a journal cannot approve or post it")
    void journalSegregationOfDutiesHolds() throws SQLException {
        Set<String> accountant = permissionsOfSystemRole("ACCOUNTANT");

        assertThat(accountant).contains(Permissions.ACCOUNTING_JOURNAL_CREATE);
        assertThat(accountant)
                .as("The preparer of a journal must not also be its approver")
                .doesNotContain(
                        Permissions.ACCOUNTING_JOURNAL_APPROVE,
                        Permissions.ACCOUNTING_JOURNAL_POST,
                        Permissions.ACCOUNTING_PERIOD_CLOSE);
    }

    @Test
    @DisplayName("platform super admin holds no permission over a school's records")
    void platformAdminCannotReachSchoolRecords() throws SQLException {
        Set<String> superAdmin = permissionsOfSystemRole("PLATFORM_SUPER_ADMIN");

        // Spec 105: least privilege still applies to the operator. Reaching into a school
        // requires a time-boxed, reasoned support grant, not a standing role.
        assertThat(superAdmin)
                .doesNotContain(
                        Permissions.STUDENT_VIEW, Permissions.HEALTH_RECORD_VIEW,
                        Permissions.DISCIPLINE_VIEW, Permissions.COUNSELLING_VIEW,
                        Permissions.REPORT_CARD_VIEW, Permissions.PAYSLIP_VIEW_ALL,
                        Permissions.FEES_VIEW, Permissions.HR_SALARY_VIEW);
    }

    // -----------------------------------------------------------------------------------

    private static Set<String> seededCodes() throws SQLException {
        Set<String> codes = new TreeSet<>();
        try (Connection c = TestDatabase.migrateConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT code FROM identity.permission")) {
            while (rs.next()) {
                codes.add(rs.getString(1));
            }
        }
        return codes;
    }

    private static Map<String, Boolean> childSensitiveFlags() throws SQLException {
        Map<String, Boolean> flags = new LinkedHashMap<>();
        try (Connection c = TestDatabase.migrateConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                     "SELECT code, is_child_sensitive FROM identity.permission")) {
            while (rs.next()) {
                flags.put(rs.getString(1), rs.getBoolean(2));
            }
        }
        return flags;
    }

    private static Set<String> permissionsOfSystemRole(String roleCode) throws SQLException {
        Set<String> codes = new TreeSet<>();
        try (Connection c = TestDatabase.migrateConnection();
             var ps = c.prepareStatement("""
                     SELECT p.code
                       FROM identity.role r
                       JOIN identity.role_permission rp ON rp.role_id = r.id
                       JOIN identity.permission p       ON p.id = rp.permission_id
                      WHERE r.code = ? AND r.tenant_id IS NULL
                     """)) {
            ps.setString(1, roleCode);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    codes.add(rs.getString(1));
                }
            }
        }
        assertThat(codes)
                .as("System role %s should exist with permissions; an empty result usually "
                        + "means the seed did not run", roleCode)
                .isNotEmpty();
        return codes;
    }
}
