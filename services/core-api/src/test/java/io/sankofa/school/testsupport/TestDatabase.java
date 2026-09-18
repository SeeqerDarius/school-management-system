package io.sankofa.school.testsupport;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;

import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import java.util.Properties;

/**
 * A real PostgreSQL for integration tests, started once per JVM.
 *
 * <h2>Why not Testcontainers</h2>
 * Docker is not available on every developer machine this project targets — it was not available
 * on the machine this was first built on. zonky ships PostgreSQL binaries and runs them directly.
 *
 * <h2>Why not H2 or an in-memory database</h2>
 * The isolation model depends on Row Level Security, deferred constraint triggers, partial
 * indexes and {@code jsonb}. H2 has none of them. A test suite green against H2 would tell us
 * nothing about the thing we most need to be sure of.
 *
 * <h2>Why the application connects as a non-superuser — the point of this class</h2>
 * A PostgreSQL superuser bypasses Row Level Security <em>unconditionally</em>. If tests connected
 * as {@code postgres}, every cross-tenant assertion would pass whether or not a single policy
 * existed, and we would ship believing tenants were isolated when they were not. That failure is
 * silent, which makes it the worst kind.
 *
 * <p>So this harness creates two roles, matching production exactly:
 * <ul>
 *   <li>{@code sankofa_migrate} — owns the schemas, holds {@code BYPASSRLS}, runs Flyway.</li>
 *   <li>{@code sankofa_app} — plain login role. No ownership, no {@code BYPASSRLS}, no superuser.
 *       Policies apply to it. This is what the application and the tests use.</li>
 * </ul>
 *
 * <p>{@code TenantIsolationIT} asserts those role attributes before it asserts anything else, so
 * that a misconfigured harness fails loudly rather than quietly granting a free pass.
 */
public final class TestDatabase {

    public static final String APP_USER = "sankofa_app";
    public static final String APP_PASSWORD = "sankofa_app_test_pw";
    public static final String MIGRATE_USER = "sankofa_migrate";
    public static final String MIGRATE_PASSWORD = "sankofa_migrate_test_pw";
    public static final String DATABASE = "sankofa_test";

    private static EmbeddedPostgres postgres;
    private static String jdbcUrl;
    private static boolean migrated;

    private TestDatabase() {
    }

    public static synchronized String jdbcUrl() {
        start();
        return jdbcUrl;
    }

    /** Starts PostgreSQL, creates the two roles and the database, and runs every migration. */
    public static synchronized void start() {
        if (postgres != null) {
            return;
        }
        try {
            postgres = EmbeddedPostgres.builder().start();
            int port = postgres.getPort();
            jdbcUrl = "jdbc:postgresql://localhost:" + port + "/" + DATABASE;

            bootstrapRolesAndDatabase(port);
            migrate();
            migrated = true;

            Runtime.getRuntime().addShutdownHook(new Thread(TestDatabase::stop));
        } catch (IOException | SQLException e) {
            throw new IllegalStateException(
                    "Could not start the embedded PostgreSQL used by integration tests", e);
        }
    }

    private static void bootstrapRolesAndDatabase(int port) throws SQLException {
        String adminUrl = "jdbc:postgresql://localhost:" + port + "/postgres";
        Properties admin = new Properties();
        admin.setProperty("user", "postgres");

        try (Connection connection = DriverManager.getConnection(adminUrl, admin);
             Statement statement = connection.createStatement()) {

            // The migration role owns the schema and bypasses RLS, because system work
            // (migrations, the outbox poller) legitimately spans tenants.
            statement.execute(
                    "CREATE ROLE " + MIGRATE_USER + " LOGIN PASSWORD '" + MIGRATE_PASSWORD
                            + "' BYPASSRLS CREATEDB");

            // The application role deliberately has none of those attributes. If this line ever
            // grows a SUPERUSER or BYPASSRLS, every isolation test in this repository becomes
            // decorative.
            statement.execute(
                    "CREATE ROLE " + APP_USER + " LOGIN PASSWORD '" + APP_PASSWORD + "'");

            statement.execute("CREATE DATABASE " + DATABASE + " OWNER " + MIGRATE_USER);
        }
    }

    private static void migrate() {
        Flyway.configure()
                .dataSource(jdbcUrl, MIGRATE_USER, MIGRATE_PASSWORD)
                .schemas("public")
                .locations("classpath:db/migration")
                .placeholders(Map.of(
                        "appRole", APP_USER,
                        "migrateRole", MIGRATE_USER))
                .validateOnMigrate(true)
                .load()
                .migrate();
    }

    /**
     * A connection as the application role — the one Row Level Security applies to.
     *
     * <p>No tenant is bound. Callers set {@code app.tenant_id} explicitly, which is exactly what
     * the production {@code TenantAwareDataSource} does per checkout.
     */
    public static Connection appConnection() throws SQLException {
        start();
        Properties props = new Properties();
        props.setProperty("user", APP_USER);
        props.setProperty("password", APP_PASSWORD);
        return DriverManager.getConnection(jdbcUrl, props);
    }

    /**
     * A connection as the migration role, which bypasses RLS.
     *
     * <p>Used only to arrange fixtures that deliberately span tenants — never to assert
     * isolation, because a BYPASSRLS role proves nothing about isolation.
     */
    public static Connection migrateConnection() throws SQLException {
        start();
        Properties props = new Properties();
        props.setProperty("user", MIGRATE_USER);
        props.setProperty("password", MIGRATE_PASSWORD);
        return DriverManager.getConnection(jdbcUrl, props);
    }

    public static boolean isMigrated() {
        return migrated;
    }

    static synchronized void stop() {
        if (postgres != null) {
            try {
                postgres.close();
            } catch (IOException e) {
                // The JVM is exiting; a failure to reap the temporary cluster is not actionable.
            } finally {
                postgres = null;
            }
        }
    }
}
