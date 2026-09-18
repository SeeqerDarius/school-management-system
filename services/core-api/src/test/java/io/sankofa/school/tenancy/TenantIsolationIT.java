package io.sankofa.school.tenancy;

import io.sankofa.school.testsupport.TestDatabase;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves Invariant I-1: a user of School A cannot reach School B's data.
 *
 * <p>Per AGENTS.md, a tenant-isolation defect is release-blocking, so these assertions are the
 * ones that must never be weakened to make a build pass. They run against real PostgreSQL as the
 * real application role — not as a superuser, which would bypass every policy and turn this whole
 * class into decoration.
 *
 * <p>The sweep at the end is the most valuable test here: rather than checking the tables that
 * exist today, it walks the catalogue for <em>any</em> table carrying a {@code tenant_id} and
 * asserts the policy is present and forced. A migration added next year that forgets RLS fails
 * this test without anyone having to remember to extend it.
 */
class TenantIsolationIT {

    /** Schemas that hold tenant-owned data. Extended as new bounded contexts land. */
    private static final List<String> TENANT_SCHEMAS = List.of(
            "platform", "identity", "school", "academics", "students", "guardians",
            "admissions", "attendance", "timetable", "assessments", "grading", "finance",
            "accounting", "hr", "payroll", "library", "inventory", "procurement", "assets",
            "transport", "hostel", "health", "discipline", "documents", "communications",
            "messaging", "audit", "analytics");

    private static UUID tenantA;
    private static UUID tenantB;

    @BeforeAll
    static void seedTwoTenants() throws SQLException {
        TestDatabase.start();
        tenantA = UUID.randomUUID();
        tenantB = UUID.randomUUID();

        // Arranged through the BYPASSRLS migration role, because creating rows in two tenants
        // at once is precisely what the application role must not be able to do.
        try (Connection c = TestDatabase.migrateConnection()) {
            insertTenant(c, tenantA, "greenfield", "Greenfield International School");
            insertTenant(c, tenantB, "akosombo", "Akosombo Model Academy");

            insertSequence(c, tenantA, "STUDENT", "STU");
            insertSequence(c, tenantB, "STUDENT", "STU");
        }
    }

    // ===================================================================================
    // Harness integrity — checked first, because everything below depends on it
    // ===================================================================================

    @Test
    @DisplayName("the application role is not a superuser and does not hold BYPASSRLS")
    void applicationRoleIsSubjectToRowLevelSecurity() throws SQLException {
        try (Connection c = TestDatabase.appConnection();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")) {
            try (ResultSet rs = ps.executeQuery()) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getBoolean("rolsuper"))
                        .as("A superuser bypasses RLS unconditionally. If this is ever true, "
                                + "every other assertion in this class is meaningless.")
                        .isFalse();
                assertThat(rs.getBoolean("rolbypassrls"))
                        .as("BYPASSRLS would defeat every tenant policy")
                        .isFalse();
            }
        }
    }

    // ===================================================================================
    // Fail closed
    // ===================================================================================

    @Test
    @DisplayName("a query with no tenant bound fails loudly instead of returning every tenant")
    void unscopedQueryIsRejected() throws SQLException {
        try (Connection c = TestDatabase.appConnection()) {
            // Deliberately do NOT set app.tenant_id. The naive failure mode for a multi-tenant
            // system is that this returns everything; platform.current_tenant_id() raises instead.
            assertThatThrownBy(() -> {
                try (Statement s = c.createStatement();
                     ResultSet rs = s.executeQuery(
                             "SELECT count(*) FROM platform.reference_sequence")) {
                    rs.next();
                }
            })
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("app.tenant_id is not set");
        }
    }

    // ===================================================================================
    // Read isolation
    // ===================================================================================

    @Test
    @DisplayName("a tenant reads only its own rows")
    void selectIsConfinedToTheBoundTenant() throws SQLException {
        try (Connection c = TestDatabase.appConnection()) {
            bindTenant(c, tenantA);

            List<UUID> visible = new ArrayList<>();
            try (Statement s = c.createStatement();
                 ResultSet rs = s.executeQuery(
                         "SELECT tenant_id FROM platform.reference_sequence")) {
                while (rs.next()) {
                    visible.add(rs.getObject(1, UUID.class));
                }
            }

            assertThat(visible)
                    .as("School A must see its own sequence row and nothing of School B's")
                    .containsExactly(tenantA);
        }
    }

    @Test
    @DisplayName("naming another tenant's id explicitly still returns nothing")
    void selectByExplicitForeignTenantIdReturnsNothing() throws SQLException {
        // The IDOR case: the caller has somehow learned School B's tenant id and asks for it
        // directly. The policy is an AND with the predicate, so the row is simply not there.
        try (Connection c = TestDatabase.appConnection()) {
            bindTenant(c, tenantA);
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT count(*) FROM platform.reference_sequence WHERE tenant_id = ?")) {
                ps.setObject(1, tenantB);
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    assertThat(rs.getLong(1)).isZero();
                }
            }
        }
    }

    // ===================================================================================
    // Write isolation
    // ===================================================================================

    @Test
    @DisplayName("a tenant cannot insert a row belonging to another tenant")
    void insertForForeignTenantIsRejected() throws SQLException {
        try (Connection c = TestDatabase.appConnection()) {
            bindTenant(c, tenantA);
            assertThatThrownBy(() -> insertSequence(c, tenantB, "INVOICE", "INV"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("row-level security");
        }
    }

    @Test
    @DisplayName("a tenant cannot move one of its rows into another tenant")
    void updateCannotReassignTenant() throws SQLException {
        try (Connection c = TestDatabase.appConnection()) {
            bindTenant(c, tenantA);
            // WITH CHECK is what stops this. USING alone would permit the row to be updated out
            // of view — visible before, gone after, and now sitting in School B's data.
            assertThatThrownBy(() -> {
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE platform.reference_sequence SET tenant_id = ? "
                                + "WHERE tenant_id = ? AND scope = 'STUDENT'")) {
                    ps.setObject(1, tenantB);
                    ps.setObject(2, tenantA);
                    ps.executeUpdate();
                }
            })
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("row-level security");
        }
    }

    @Test
    @DisplayName("a tenant cannot delete another tenant's row")
    void deleteCannotReachForeignRows() throws SQLException {
        try (Connection c = TestDatabase.appConnection()) {
            bindTenant(c, tenantA);
            int deleted;
            try (PreparedStatement ps = c.prepareStatement(
                    "DELETE FROM platform.reference_sequence WHERE tenant_id = ?")) {
                ps.setObject(1, tenantB);
                deleted = ps.executeUpdate();
            }
            // Not an error — the row is simply invisible, so nothing matches. The important
            // assertion is that School B's row still exists afterwards.
            assertThat(deleted).isZero();
        }

        try (Connection c = TestDatabase.migrateConnection();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT count(*) FROM platform.reference_sequence WHERE tenant_id = ?")) {
            ps.setObject(1, tenantB);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                assertThat(rs.getLong(1))
                        .as("School B's row must survive School A's delete attempt")
                        .isEqualTo(1L);
            }
        }
    }

    @Test
    @DisplayName("switching the bound tenant switches the visible rows")
    void rebindingTenantChangesVisibility() throws SQLException {
        try (Connection c = TestDatabase.appConnection()) {
            bindTenant(c, tenantA);
            assertThat(countVisibleSequences(c)).isEqualTo(1L);

            // The pooled-connection reuse case: the same physical connection now serves a
            // different school. TenantAwareDataSource rebinds on every checkout for this reason.
            bindTenant(c, tenantB);
            List<UUID> visible = new ArrayList<>();
            try (Statement s = c.createStatement();
                 ResultSet rs = s.executeQuery(
                         "SELECT tenant_id FROM platform.reference_sequence")) {
                while (rs.next()) {
                    visible.add(rs.getObject(1, UUID.class));
                }
            }
            assertThat(visible).containsExactly(tenantB);
        }
    }

    // ===================================================================================
    // Catalogue sweep — the regression guard for every future migration
    // ===================================================================================

    @Test
    @DisplayName("every table with a tenant_id column has RLS enabled AND forced")
    void everyTenantOwnedTableIsProtected() throws SQLException {
        List<String> unprotected = new ArrayList<>();

        String sql = """
                SELECT n.nspname AS schema_name,
                       c.relname  AS table_name,
                       c.relrowsecurity,
                       c.relforcerowsecurity
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r'
                   AND n.nspname = ANY (?)
                   AND EXISTS (
                        SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid
                           AND a.attname = 'tenant_id'
                           AND NOT a.attisdropped)
                 ORDER BY 1, 2
                """;

        try (Connection c = TestDatabase.migrateConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setArray(1, c.createArrayOf("text", TENANT_SCHEMAS.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String table = rs.getString("schema_name") + "." + rs.getString("table_name");
                    if (!rs.getBoolean("relrowsecurity")) {
                        unprotected.add(table + " — RLS not enabled");
                    } else if (!rs.getBoolean("relforcerowsecurity")) {
                        // Without FORCE, the table owner silently bypasses its own policy.
                        unprotected.add(table + " — RLS enabled but not FORCEd");
                    }
                }
            }
        }

        assertThat(unprotected)
                .as("Every table carrying tenant_id must ENABLE and FORCE row level security "
                        + "in the migration that creates it (AGENTS.md §5). Offenders:\n  %s",
                        String.join("\n  ", unprotected))
                .isEmpty();
    }

    @Test
    @DisplayName("every RLS-enabled tenant table actually carries at least one policy")
    void protectedTablesHavePolicies() throws SQLException {
        List<String> policyless = new ArrayList<>();

        // ENABLE without a policy denies everything, which looks secure but breaks the feature.
        // Both failure directions are worth catching.
        String sql = """
                SELECT n.nspname AS schema_name, c.relname AS table_name
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r'
                   AND c.relrowsecurity
                   AND n.nspname = ANY (?)
                   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
                 ORDER BY 1, 2
                """;

        try (Connection c = TestDatabase.migrateConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setArray(1, c.createArrayOf("text", TENANT_SCHEMAS.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    policyless.add(rs.getString("schema_name") + "." + rs.getString("table_name"));
                }
            }
        }

        assertThat(policyless)
                .as("These tables have RLS enabled but no policy, so they deny everything: %s",
                        policyless)
                .isEmpty();
    }

    // ===================================================================================
    // Helpers
    // ===================================================================================

    private static void bindTenant(Connection c, UUID tenantId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT set_config('app.tenant_id', ?, false)")) {
            ps.setString(1, tenantId.toString());
            ps.execute();
        }
    }

    private static long countVisibleSequences(Connection c) throws SQLException {
        try (Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT count(*) FROM platform.reference_sequence")) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private static void insertTenant(Connection c, UUID id, String slug, String name)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO platform.tenant
                    (id, slug, legal_name, display_name, status, country_code,
                     default_currency, timezone, locale)
                VALUES (?, ?, ?, ?, 'ACTIVE', 'GH', 'GHS', 'Africa/Accra', 'en-GH')
                """)) {
            ps.setObject(1, id);
            ps.setString(2, slug);
            ps.setString(3, name);
            ps.setString(4, name);
            ps.executeUpdate();
        }
    }

    private static void insertSequence(Connection c, UUID tenantId, String scope, String prefix)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO platform.reference_sequence
                    (tenant_id, scope, period_key, prefix, pad_width, next_value)
                VALUES (?, ?, '2026', ?, 6, 1)
                """)) {
            ps.setObject(1, tenantId);
            ps.setString(2, scope);
            ps.setString(3, prefix);
            ps.executeUpdate();
        }
    }
}
