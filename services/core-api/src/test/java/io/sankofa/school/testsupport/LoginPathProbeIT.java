package io.sankofa.school.testsupport;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs each statement of the sign-in path as the application role, with no tenant bound.
 *
 * <p>Sign-in is the one flow that legitimately executes before any tenant exists, so it is the
 * flow most likely to collide with a Row Level Security policy — and the collision surfaces as
 * an opaque 500 rather than as anything that names the offending statement. This test executes
 * the statements individually so a future regression points straight at the culprit.
 */
class LoginPathProbeIT {

    @Test
    @DisplayName("the SECURITY DEFINER functions are owned by a role that bypasses RLS")
    void definerFunctionsBypassRowLevelSecurity() throws SQLException {
        try (Connection c = TestDatabase.appConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT p.proname, r.rolname, r.rolbypassrls, p.prosecdef
                       FROM pg_proc p
                       JOIN pg_roles r ON r.oid = p.proowner
                       JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'identity'
                        AND p.proname IN ('resolve_login', 'memberships_for_user',
                                          'record_security_event', 'record_sign_in')
                      ORDER BY p.proname
                     """)) {
            int found = 0;
            while (rs.next()) {
                found++;
                String name = rs.getString("proname");
                assertThat(rs.getBoolean("prosecdef"))
                        .as("%s must be SECURITY DEFINER", name).isTrue();
                assertThat(rs.getBoolean("rolbypassrls"))
                        .as("%s is owned by %s, which does not bypass RLS — the function would "
                                + "be filtered by the policies it exists to work around",
                                name, rs.getString("rolname"))
                        .isTrue();
            }
            assertThat(found).as("all four login-path functions must exist").isEqualTo(4);
        }
    }

    @Test
    @DisplayName("each sign-in statement runs with no tenant bound")
    void eachSignInStatementRunsUnscoped() throws SQLException {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();
        String uid = "probe-uid-" + UUID.randomUUID();
        String email = "probe-" + UUID.randomUUID() + "@example.test";

        try (Connection c = TestDatabase.migrateConnection()) {
            try (PreparedStatement ps = c.prepareStatement("""
                    INSERT INTO platform.tenant
                        (id, slug, legal_name, display_name, status, country_code,
                         default_currency, timezone, locale)
                    VALUES (?, ?, 'Probe School', 'Probe School', 'ACTIVE', 'GH', 'GHS',
                            'Africa/Accra', 'en-GH')
                    """)) {
                ps.setObject(1, tenantId);
                ps.setString(2, "probe-" + tenantId.toString().substring(0, 8));
                ps.executeUpdate();
            }
            try (PreparedStatement ps = c.prepareStatement("""
                    INSERT INTO identity.app_user
                        (id, firebase_uid, email, email_verified, full_name, status)
                    VALUES (?, NULL, ?, false, 'Probe User', 'PENDING_INVITE')
                    """)) {
                ps.setObject(1, userId);
                ps.setString(2, email);
                ps.executeUpdate();
            }
            try (PreparedStatement ps = c.prepareStatement("""
                    INSERT INTO identity.membership
                        (id, tenant_id, user_id, status, principal_type, started_on)
                    VALUES (?, ?, ?, 'ACTIVE', 'TEACHER', current_date)
                    """)) {
                ps.setObject(1, membershipId);
                ps.setObject(2, tenantId);
                ps.setObject(3, userId);
                ps.executeUpdate();
            }
        }

        // Everything below runs as the application role with app.tenant_id deliberately unset,
        // exactly as the real sign-in does.
        try (Connection c = TestDatabase.appConnection()) {

            step(c, "resolve_login", () -> {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT user_id, status FROM identity.resolve_login(?, ?, ?)")) {
                    ps.setString(1, uid);
                    ps.setString(2, email);
                    ps.setBoolean(3, true);
                    try (ResultSet rs = ps.executeQuery()) {
                        assertThat(rs.next()).as("the invitation should be claimed").isTrue();
                    }
                }
            });

            step(c, "insert user_session", () -> {
                try (PreparedStatement ps = c.prepareStatement("""
                        INSERT INTO identity.user_session
                            (id, user_id, membership_id, token_hash, issued_at, expires_at,
                             ip_address, user_agent, mfa_satisfied)
                        VALUES (?, ?, NULL, ?, now(), now() + interval '1 hour',
                                cast(? AS inet), ?, false)
                        """)) {
                    ps.setObject(1, UUID.randomUUID());
                    ps.setObject(2, userId);
                    ps.setBytes(3, new byte[]{1, 2, 3});
                    ps.setString(4, "127.0.0.1");
                    ps.setString(5, "probe");
                    ps.executeUpdate();
                }
            });

            step(c, "record_sign_in", () -> {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT identity.record_sign_in(?)")) {
                    ps.setObject(1, userId);
                    ps.execute();
                }
            });

            step(c, "record_security_event", () -> {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT identity.record_security_event(?, NULL, ?, ?, ?, ?)")) {
                    ps.setObject(1, userId);
                    ps.setString(2, "SIGN_IN_SUCCEEDED");
                    ps.setString(3, "INFO");
                    ps.setString(4, "127.0.0.1");
                    ps.setString(5, "probe");
                    ps.execute();
                }
            });

            // The trap that produced an opaque 500: identity.membership carries a FOR ALL
            // policy whose USING clause is evaluated on SELECT as well. While that clause
            // called the raising accessor, every unscoped membership lookup threw 42501 —
            // and the sign-in path is unscoped by definition.
            step(c, "select membership directly (FOR ALL policy evaluated on SELECT)", () -> {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT id, tenant_id, status FROM identity.membership WHERE id = ?")) {
                    ps.setObject(1, membershipId);
                    try (ResultSet rs = ps.executeQuery()) {
                        assertThat(rs.next())
                                .as("with no tenant bound the row must be invisible, not an error")
                                .isFalse();
                    }
                }
            });

            step(c, "record_security_event for an anonymous refusal", () -> {
                // The single most important event to be able to record: a sign-in refused for
                // an address matching no account. No user, no tenant, still auditable.
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT identity.record_security_event(NULL, NULL, ?, ?, ?, ?)")) {
                    ps.setString(1, "SIGN_IN_REFUSED_NO_ACCOUNT");
                    ps.setString(2, "NOTICE");
                    ps.setString(3, "127.0.0.1");
                    ps.setString(4, "probe");
                    ps.execute();
                }
            });

            step(c, "memberships_for_user", () -> {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT membership_id, tenant_slug FROM identity.memberships_for_user(?)")) {
                    ps.setObject(1, userId);
                    try (ResultSet rs = ps.executeQuery()) {
                        assertThat(rs.next()).as("the school should be visible").isTrue();
                    }
                }
            });
        }
    }

    private interface Step {
        void run() throws SQLException;
    }

    private static void step(Connection c, String name, Step step) {
        try {
            step.run();
        } catch (SQLException e) {
            throw new AssertionError(
                    "Sign-in step '" + name + "' failed with no tenant bound: " + e.getMessage(), e);
        }
    }
}
