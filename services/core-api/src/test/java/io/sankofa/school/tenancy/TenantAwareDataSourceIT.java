package io.sankofa.school.tenancy;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.sankofa.school.testsupport.TestDatabase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves that {@link TenantAwareDataSource} binds and, critically, <em>clears</em> the tenant on
 * a pooled connection.
 *
 * <p>{@link TenantIsolationIT} proves the database enforces isolation once a tenant is bound.
 * This class proves the Java side binds the right one — and, more importantly, that a connection
 * returned to the pool does not carry School A's tenant into School B's next request. That is the
 * specific leak the class exists to prevent, and it is invisible to every SQL-level test.
 *
 * <p>The pool is deliberately capped at a single connection, so every checkout is guaranteed to
 * be the <em>same physical connection</em> that the previous test step handed back. Without that,
 * a pool would hand out a fresh connection each time and the test would pass while proving
 * nothing.
 */
class TenantAwareDataSourceIT {

    private static HikariDataSource pool;
    private static DataSource tenantAware;

    private static final UUID TENANT_A = UUID.randomUUID();
    private static final UUID TENANT_B = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();

    @BeforeAll
    static void setUp() {
        TestDatabase.start();

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(TestDatabase.jdbcUrl());
        config.setUsername(TestDatabase.APP_USER);
        config.setPassword(TestDatabase.APP_PASSWORD);
        // One connection, so reuse is guaranteed rather than incidental.
        config.setMaximumPoolSize(1);
        config.setMinimumIdle(1);
        config.setPoolName("tenant-binding-test");
        pool = new HikariDataSource(config);

        tenantAware = new TenantAwareDataSource(pool);
    }

    @AfterAll
    static void tearDown() {
        TenantContextHolder.clear();
        if (pool != null) {
            pool.close();
        }
    }

    @Test
    @DisplayName("the bound tenant reaches the PostgreSQL session")
    void bindsTenantOnCheckout() throws Exception {
        TenantContextHolder.runAs(tenantContext(TENANT_A), () -> {
            try (Connection c = tenantAware.getConnection()) {
                assertThat(sessionSetting(c, "app.tenant_id")).isEqualTo(TENANT_A.toString());
                assertThat(sessionSetting(c, "app.user_id")).isEqualTo(USER.toString());
                assertThat(sessionSetting(c, "app.platform_scope")).isEqualTo("false");
            }
            return null;
        });
    }

    @Test
    @DisplayName("a connection returned to the pool no longer carries the previous tenant")
    void clearsTenantOnClose() throws Exception {
        // Step 1: School A uses the connection and hands it back.
        TenantContextHolder.runAs(tenantContext(TENANT_A), () -> {
            try (Connection c = tenantAware.getConnection()) {
                assertThat(sessionSetting(c, "app.tenant_id")).isEqualTo(TENANT_A.toString());
            }
            return null;
        });

        // Step 2: the very same physical connection is checked out with no context at all.
        // If close() had not cleared the session, this would still say School A — and any
        // query on it would silently read School A's rows on behalf of an anonymous caller.
        TenantContextHolder.clear();
        try (Connection c = tenantAware.getConnection()) {
            assertThat(sessionSetting(c, "app.tenant_id"))
                    .as("a pooled connection must not carry a tenant across checkouts")
                    .isEmpty();
            assertThat(sessionSetting(c, "app.user_id")).isEmpty();
        }
    }

    @Test
    @DisplayName("consecutive checkouts by different tenants each see only their own tenant")
    void rebindsBetweenTenants() throws Exception {
        TenantContextHolder.runAs(tenantContext(TENANT_A), () -> {
            try (Connection c = tenantAware.getConnection()) {
                assertThat(sessionSetting(c, "app.tenant_id")).isEqualTo(TENANT_A.toString());
            }
            return null;
        });

        TenantContextHolder.runAs(tenantContext(TENANT_B), () -> {
            try (Connection c = tenantAware.getConnection()) {
                assertThat(sessionSetting(c, "app.tenant_id"))
                        .as("the second tenant must overwrite the first, not inherit it")
                        .isEqualTo(TENANT_B.toString());
            }
            return null;
        });
    }

    @Test
    @DisplayName("a platform-scope context sets no tenant but flags platform scope")
    void bindsPlatformScope() throws Exception {
        TenantContextHolder.runAs(TenantContext.ofPlatform(USER, Set.of()), () -> {
            try (Connection c = tenantAware.getConnection()) {
                assertThat(sessionSetting(c, "app.tenant_id")).isEmpty();
                assertThat(sessionSetting(c, "app.platform_scope")).isEqualTo("true");
            }
            return null;
        });
    }

    @Test
    @DisplayName("platform scope is cleared too, and does not leak into the next checkout")
    void clearsPlatformScope() throws Exception {
        TenantContextHolder.runAs(TenantContext.ofPlatform(USER, Set.of()), () -> {
            try (Connection c = tenantAware.getConnection()) {
                assertThat(sessionSetting(c, "app.platform_scope")).isEqualTo("true");
            }
            return null;
        });

        // A leaked platform scope would let an ordinary request read the tenant registry and
        // every tenant's usage counters.
        TenantContextHolder.clear();
        try (Connection c = tenantAware.getConnection()) {
            assertThat(sessionSetting(c, "app.platform_scope")).isEqualTo("false");
        }
    }

    @Test
    @DisplayName("with no context bound, a tenant query still fails closed")
    void noContextStillFailsClosed() throws SQLException {
        TenantContextHolder.clear();
        try (Connection c = tenantAware.getConnection();
             Statement s = c.createStatement()) {
            // End to end: no context in Java, therefore no tenant in PostgreSQL, therefore
            // platform.current_tenant_id() raises rather than the query returning everything.
            org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                            s.executeQuery("SELECT count(*) FROM platform.reference_sequence"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("app.tenant_id is not set");
        }
    }

    // -----------------------------------------------------------------------------------

    private static TenantContext tenantContext(UUID tenantId) {
        return TenantContext.ofTenant(USER, tenantId, UUID.randomUUID(), Set.of());
    }

    private static String sessionSetting(Connection c, String name) throws SQLException {
        try (Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                     "SELECT coalesce(current_setting('" + name + "', true), '')")) {
            rs.next();
            return rs.getString(1);
        }
    }
}
