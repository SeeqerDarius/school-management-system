package io.sankofa.school.devstack;

import io.sankofa.school.CoreApiApplication;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;
import org.springframework.boot.builder.SpringApplicationBuilder;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

/**
 * Runs the whole service locally against a throwaway PostgreSQL.
 *
 * <p>A development convenience, deliberately living in {@code src/test/java} so it is never
 * packaged into the application jar and can never run anywhere but a developer's machine.
 *
 * <p>It exists because getting a working local stack otherwise means installing PostgreSQL,
 * knowing its superuser password, and running the role bootstrap by hand — enough friction that
 * people skip it and stop running the thing they are building. This does all of it in one
 * command and leaves nothing behind.
 *
 * <pre>
 *   scripts/dev-stack.sh
 * </pre>
 *
 * <h2>What it does not do</h2>
 * It does not fake authentication. The application still resolves its identity provider the
 * normal way: with no Firebase project configured it uses the refusing verifier, so sign-in
 * fails exactly as it would in a misconfigured deployment. To sign in locally, point
 * {@code FIREBASE_AUTH_EMULATOR_HOST} at the Firebase Auth emulator (§86) and set
 * {@code FIREBASE_PROJECT_ID}; the real verifier is then used, against the emulator.
 *
 * <p>That is the one design rule here worth stating: a development stack may substitute the
 * <em>provider</em>, and must never substitute the <em>verification</em>.
 */
public final class DevStack {

    private static final String APP_USER = "sankofa_app";
    private static final String APP_PASSWORD = "dev_only_app_password";
    private static final String MIGRATE_USER = "sankofa_migrate";
    private static final String MIGRATE_PASSWORD = "dev_only_migrate_password";
    private static final String DATABASE = "sankofa_dev";

    private DevStack() {
    }

    public static void main(String[] args) throws Exception {
        System.out.println("""
                ─────────────────────────────────────────────────────────────
                 Sankofa dev stack
                 Embedded PostgreSQL · migrations · demo data · core API
                ─────────────────────────────────────────────────────────────""");

        EmbeddedPostgres postgres = EmbeddedPostgres.builder().start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> close(postgres)));

        int port = postgres.getPort();
        String jdbcUrl = "jdbc:postgresql://localhost:" + port + "/" + DATABASE;
        System.out.println("  PostgreSQL  " + jdbcUrl);

        bootstrapRoles(port);
        migrate(jdbcUrl);
        Map<String, String> demo = seedDemoSchool(jdbcUrl);

        System.out.println("""

                 Demo school seeded
                ─────────────────────────────────────────────────────────────""");
        demo.forEach((k, v) -> System.out.printf("  %-14s %s%n", k, v));

        String emulator = System.getenv("FIREBASE_AUTH_EMULATOR_HOST");
        String projectId = System.getenv().getOrDefault("FIREBASE_PROJECT_ID", "");
        System.out.println("""

                 Identity provider
                ─────────────────────────────────────────────────────────────""");
        if (emulator != null && !emulator.isBlank()) {
            System.out.println("  Firebase Auth emulator at " + emulator
                    + " (project " + projectId + ")");
            System.out.println("  Real token verification, against the emulator.");
        } else {
            System.out.println("  None configured — sign-in will be refused.");
            System.out.println("  Start the Firebase Auth emulator and set");
            System.out.println("  FIREBASE_AUTH_EMULATOR_HOST + FIREBASE_PROJECT_ID to sign in.");
        }

        System.out.println("""

                 Starting the API on http://localhost:8080
                 OpenAPI:  http://localhost:8080/v3/api-docs
                 Swagger:  http://localhost:8080/swagger-ui.html
                 Health:   http://localhost:8080/actuator/health
                ─────────────────────────────────────────────────────────────
                """);

        new SpringApplicationBuilder(CoreApiApplication.class)
                .properties(
                        // application.yml reads these, and Spring resolves them while
                        // evaluating auto-configuration conditions — even for Flyway, which is
                        // disabled below. Supplying them all is also more honest: the dev stack
                        // provides exactly the configuration a real environment would, rather
                        // than a special path through the config.
                        "DB_URL=" + jdbcUrl,
                        "DB_APP_USER=" + APP_USER,
                        "DB_APP_PASSWORD=" + APP_PASSWORD,
                        "DB_MIGRATE_USER=" + MIGRATE_USER,
                        "DB_MIGRATE_PASSWORD=" + MIGRATE_PASSWORD,
                        // The application connects as the role RLS applies to — never as the
                        // migration role. Getting this wrong locally would mean developing
                        // against a system where tenant isolation silently does not work.
                        "spring.datasource.url=" + jdbcUrl,
                        "spring.datasource.username=" + APP_USER,
                        "spring.datasource.password=" + APP_PASSWORD,
                        // Already applied above, as the migration role.
                        "spring.flyway.enabled=false",
                        "sankofa.firebase.project-id=" + projectId,
                        "SWAGGER_UI_ENABLED=true",
                        "springdoc.swagger-ui.enabled=true",
                        "server.port=8080",
                        "logging.level.io.sankofa.school=INFO")
                .run(args);
    }

    // ===================================================================================

    private static void bootstrapRoles(int port) throws SQLException {
        String adminUrl = "jdbc:postgresql://localhost:" + port + "/postgres";
        Properties admin = new Properties();
        admin.setProperty("user", "postgres");

        try (Connection c = DriverManager.getConnection(adminUrl, admin);
             Statement s = c.createStatement()) {

            s.execute("CREATE ROLE " + MIGRATE_USER + " LOGIN PASSWORD '"
                    + MIGRATE_PASSWORD + "' BYPASSRLS CREATEDB");
            // No BYPASSRLS, no superuser. Same split as production, for the same reason.
            s.execute("CREATE ROLE " + APP_USER + " LOGIN PASSWORD '" + APP_PASSWORD + "'");
            s.execute("CREATE DATABASE " + DATABASE + " OWNER " + MIGRATE_USER);
        }
        System.out.println("  Roles       " + MIGRATE_USER + " (BYPASSRLS), "
                + APP_USER + " (RLS applies)");
    }

    private static void migrate(String jdbcUrl) {
        var result = Flyway.configure()
                .dataSource(jdbcUrl, MIGRATE_USER, MIGRATE_PASSWORD)
                .schemas("public")
                .locations("classpath:db/migration")
                .placeholders(Map.of("appRole", APP_USER, "migrateRole", MIGRATE_USER))
                .load()
                .migrate();
        System.out.println("  Migrations  " + result.migrationsExecuted + " applied, now at "
                + result.targetSchemaVersion);
    }

    /**
     * Seeds one school with an invited administrator.
     *
     * <p>An <em>invitation</em>, not an account: the user row has no provider uid, exactly as a
     * school administrator's would after inviting a colleague. Signing in for the first time
     * claims it through the normal {@code resolve_login} path, so the local stack exercises the
     * real flow rather than a shortcut around it.
     */
    private static Map<String, String> seedDemoSchool(String jdbcUrl) throws SQLException {
        UUID tenantId = UUID.randomUUID();
        UUID adminUserId = UUID.randomUUID();
        UUID adminMembershipId = UUID.randomUUID();
        UUID campusId = UUID.randomUUID();
        String adminEmail = "admin@greenfield.example";

        Properties props = new Properties();
        props.setProperty("user", MIGRATE_USER);
        props.setProperty("password", MIGRATE_PASSWORD);

        try (Connection c = DriverManager.getConnection(jdbcUrl, props)) {
            exec(c, """
                    INSERT INTO platform.tenant
                        (id, slug, legal_name, display_name, short_name, status, country_code,
                         default_currency, timezone, locale, onboarding_state)
                    VALUES (?, 'greenfield', 'Greenfield International School',
                            'Greenfield International School', 'Greenfield', 'ACTIVE', 'GH',
                            'GHS', 'Africa/Accra', 'en-GH', 'IN_PROGRESS')
                    """, tenantId);

            exec(c, """
                    INSERT INTO identity.app_user
                        (id, firebase_uid, email, email_verified, full_name, status)
                    VALUES (?, NULL, ?, false, 'Ama Mensah', 'PENDING_INVITE')
                    """, adminUserId, adminEmail);

            exec(c, """
                    INSERT INTO identity.membership
                        (id, tenant_id, user_id, status, principal_type, started_on)
                    VALUES (?, ?, ?, 'ACTIVE', 'STAFF', current_date)
                    """, adminMembershipId, tenantId, adminUserId);

            try (PreparedStatement ps = c.prepareStatement("""
                    INSERT INTO identity.membership_role (membership_id, role_id)
                    SELECT ?, r.id FROM identity.role r
                     WHERE r.code = 'SCHOOL_ADMIN' AND r.tenant_id IS NULL
                    """)) {
                ps.setObject(1, adminMembershipId);
                ps.executeUpdate();
            }

            exec(c, """
                    INSERT INTO school.campus
                        (id, tenant_id, code, name, is_main, status, city, region, country_code)
                    VALUES (?, ?, 'MAIN', 'Main Campus', true, 'ACTIVE', 'Accra',
                            'Greater Accra', 'GH')
                    """, campusId, tenantId);
        }

        Map<String, String> summary = new LinkedHashMap<>();
        summary.put("School", "Greenfield International School (slug: greenfield)");
        summary.put("Administrator", adminEmail + "  — invited, not yet linked");
        summary.put("Role", "SCHOOL_ADMIN");
        summary.put("Campus", "MAIN — Main Campus, Accra");
        summary.put("Membership id", adminMembershipId.toString());
        return summary;
    }

    private static void exec(Connection c, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            ps.executeUpdate();
        }
    }

    private static void close(EmbeddedPostgres postgres) {
        try {
            postgres.close();
        } catch (Exception ignored) {
            // Shutting down; a temporary cluster that outlives the JVM is not actionable.
        }
    }
}
