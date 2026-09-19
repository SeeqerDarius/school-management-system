package io.sankofa.school.school.api;

import io.sankofa.school.school.api.CampusController.CampusResponse;
import io.sankofa.school.school.api.CampusController.CreateCampusRequest;
import io.sankofa.school.testsupport.AbstractApiIT;
import io.sankofa.school.testsupport.TestDatabase;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Campuses and branding over HTTP — the rest of Phase 2.
 *
 * <p>The branding assertions are the interesting ones. They prove the asymmetry §94 calls for:
 * a school's colour is accepted wherever we can choose a readable partner for it, and refused
 * only where the page decides the background and the result would be illegible.
 */
class SchoolSettingsApiIT extends AbstractApiIT {

    private static Principal adminA;
    private static Principal headA;
    private static Principal teacherA;
    private static Principal adminB;
    private static UUID tenantA;
    private static UUID tenantB;

    private static final AtomicInteger SEQ = new AtomicInteger(1);

    private record Principal(UUID userId, UUID membershipId, String uid, String email) {
    }

    @BeforeAll
    static void seed() throws SQLException {
        TestDatabase.start();
        tenantA = UUID.randomUUID();
        tenantB = UUID.randomUUID();

        try (Connection c = TestDatabase.migrateConnection()) {
            insertTenant(c, tenantA, "greenfield-settings", "Greenfield International School");
            insertTenant(c, tenantB, "akosombo-settings", "Akosombo Model Academy");

            adminA = principal(c, tenantA, "set-admin-a", "SCHOOL_ADMIN");
            headA = principal(c, tenantA, "set-head-a", "HEADMASTER");
            teacherA = principal(c, tenantA, "set-teacher-a", "TEACHER");
            adminB = principal(c, tenantB, "set-admin-b", "SCHOOL_ADMIN");
        }
    }

    // ===================================================================================

    @Nested
    @DisplayName("campus permissions")
    class Permissions {

        @Test
        @DisplayName("an administrator may list and create campuses")
        void adminMayManage() {
            String token = signIn(adminA);
            assertThat(get(token, "/api/v1/campuses").getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(createCampus(token).getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        @DisplayName("a headmaster may view settings but not change campuses")
        void headMayViewNotManage() {
            String token = signIn(headA);
            // TENANT_SETTINGS_VIEW without TENANT_CAMPUS_MANAGE — the distinction the two
            // separate permissions exist to express.
            assertThat(get(token, "/api/v1/campuses").getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(createCampus(token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        @DisplayName("a teacher may do neither")
        void teacherMayNeither() {
            String token = signIn(teacherA);
            assertThat(get(token, "/api/v1/campuses").getStatusCode())
                    .isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(createCampus(token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    @DisplayName("campus lifecycle")
    class Lifecycle {

        @Test
        @DisplayName("the first campus becomes the main one automatically")
        void firstCampusIsMain() {
            // A single-site school should never have to know this concept exists, and a
            // multi-site one should not start with nothing designated.
            String token = signIn(adminB);

            ResponseEntity<List<CampusResponse>> before = rest.exchange(
                    "/api/v1/campuses", HttpMethod.GET, authorised(token),
                    new ParameterizedTypeReference<>() { });
            assertThat(before.getBody()).isEmpty();

            CampusResponse created = createCampus(token).getBody();
            assertThat(created).isNotNull();
            assertThat(created.main()).isTrue();
            assertThat(created.status()).isEqualTo("ACTIVE");
        }

        @Test
        @DisplayName("the main campus cannot be closed while it holds the designation")
        void mainCampusCannotBeClosed() {
            String token = signIn(adminA);
            CampusResponse main = mainCampusFor(token);

            ResponseEntity<Map> closed = rest.exchange(
                    "/api/v1/campuses/" + main.id() + "/close", HttpMethod.POST,
                    authorised(token, Map.of("reason", "Consolidating sites")), Map.class);

            // Otherwise a school can close its way into having no main campus, and every
            // report header becomes unattributed.
            assertThat(closed.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(String.valueOf(closed.getBody().get("message")))
                    .contains("another campus the main one");
        }

        @Test
        @DisplayName("designating a new main campus clears the old one")
        void mainDesignationMoves() {
            String token = signIn(adminA);
            CampusResponse second = createCampus(token).getBody();
            assertThat(second).isNotNull();
            assertThat(second.main()).as("a later campus is not main by default").isFalse();

            ResponseEntity<CampusResponse> promoted = rest.exchange(
                    "/api/v1/campuses/" + second.id() + "/make-main", HttpMethod.POST,
                    authorised(token, null), CampusResponse.class);

            assertThat(promoted.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(promoted.getBody()).isNotNull();
            assertThat(promoted.getBody().main()).isTrue();

            // Exactly one main campus, enforced by a partial unique index as well as by this.
            ResponseEntity<List<CampusResponse>> all = rest.exchange(
                    "/api/v1/campuses", HttpMethod.GET, authorised(token),
                    new ParameterizedTypeReference<>() { });
            assertThat(all.getBody()).filteredOn(CampusResponse::main).hasSize(1);
        }

        @Test
        @DisplayName("a duplicate campus code is refused by field")
        void duplicateCodeRefused() {
            String token = signIn(adminA);
            String code = "DUP" + SEQ.getAndIncrement();

            rest.exchange("/api/v1/campuses", HttpMethod.POST,
                    authorised(token, newCampus(code, "First")), CampusResponse.class);

            ResponseEntity<Map> duplicate = rest.exchange("/api/v1/campuses", HttpMethod.POST,
                    authorised(token, newCampus(code.toLowerCase(java.util.Locale.ROOT), "Second")),
                    Map.class);

            // Case-insensitive: "MAIN" and "main" are the same campus code to a human.
            assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(duplicate.getBody()).containsEntry("code", "VALIDATION_ERROR");
        }

        @Test
        @DisplayName("one school cannot reach another's campus")
        void tenantIsolationHolds() {
            CampusResponse ofA = createCampus(signIn(adminA)).getBody();
            assertThat(ofA).isNotNull();

            String tokenB = signIn(adminB);
            assertThat(get(tokenB, "/api/v1/campuses/" + ofA.id()).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND);

            ResponseEntity<String> promote = rest.exchange(
                    "/api/v1/campuses/" + ofA.id() + "/make-main", HttpMethod.POST,
                    authorised(tokenB, null), String.class);
            assertThat(promote.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        }
    }

    @Nested
    @DisplayName("branding")
    class BrandingRules {

        @Test
        @DisplayName("a school with no branding gets defaults, not an error")
        void defaultsWhenUnset() {
            ResponseEntity<Map> response = rest.exchange(
                    "/api/v1/branding", HttpMethod.GET, authorised(signIn(adminB)), Map.class);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody()).containsEntry("hasLogo", false);
        }

        @Test
        @DisplayName("any primary colour is accepted, and its readable text colour is computed")
        void primaryColourAlwaysAccepted() {
            String token = signIn(adminA);

            // A mid grey — the colour that sits closest to the contrast crossover. It is still
            // usable as a background, because we choose the ink that goes on it.
            ResponseEntity<Map> response = rest.exchange("/api/v1/branding", HttpMethod.PUT,
                    authorised(token, Map.of(
                            "primaryColor", "#808080",
                            "motto", "Knowledge and Character",
                            "version", brandingVersion(token))),
                    Map.class);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody()).containsEntry("primaryColor", "#808080");
            assertThat(response.getBody().get("primaryInk"))
                    .as("the readable text colour must be computed, not left to the client")
                    .isIn("#000000", "#FFFFFF");
        }

        @Test
        @DisplayName("an accent colour unreadable on the page is refused with advice")
        void unreadableAccentRefused() {
            String token = signIn(adminA);

            // A light gold as link text on white. No pairing fixes this — the page decides
            // the background.
            ResponseEntity<Map> response = rest.exchange("/api/v1/branding", HttpMethod.PUT,
                    authorised(token, Map.of("accentColor", "#FFE066", "version", brandingVersion(token))),
                    Map.class);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(String.valueOf(response.getBody().get("message")))
                    .contains("not readable as text")
                    // It must say where the colour can still be used, or the school just hears
                    // "your brand is rejected".
                    .contains("buttons and headers");
        }

        @Test
        @DisplayName("a dark accent colour is accepted and reports its contrast")
        void readableAccentAccepted() {
            String token = signIn(adminA);

            ResponseEntity<Map> response = rest.exchange("/api/v1/branding", HttpMethod.PUT,
                    authorised(token, Map.of("accentColor", "#1F5B8F", "version", brandingVersion(token))),
                    Map.class);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody()).containsEntry("accentColor", "#1F5B8F");
            assertThat((Double) response.getBody().get("accentContrastOnPage"))
                    .isGreaterThanOrEqualTo(4.5);
        }

        @Test
        @DisplayName("a logo is recorded by storage path, never by URL")
        void logoMustBeStoragePath() {
            String token = signIn(adminA);

            // A URL would mean a dead link within the hour, or a public bucket holding
            // children's school crests. Both are wrong.
            ResponseEntity<Map> url = rest.exchange("/api/v1/branding/logo", HttpMethod.POST,
                    authorised(token, Map.of("logoPath", "https://example.com/crest.png")),
                    Map.class);
            assertThat(url.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

            ResponseEntity<Map> path = rest.exchange("/api/v1/branding/logo", HttpMethod.POST,
                    authorised(token, Map.of("logoPath", "tenants/greenfield/logo.png")),
                    Map.class);
            assertThat(path.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(path.getBody()).containsEntry("hasLogo", true);
        }

        @Test
        @DisplayName("a headmaster may read branding but not change it")
        void brandingPermissions() {
            String head = signIn(headA);

            assertThat(rest.exchange("/api/v1/branding", HttpMethod.GET, authorised(head),
                    String.class).getStatusCode()).isEqualTo(HttpStatus.OK);

            assertThat(rest.exchange("/api/v1/branding", HttpMethod.PUT,
                    authorised(head, Map.of("motto", "Changed", "version", 0)), String.class)
                    .getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        @DisplayName("one school cannot read another's branding")
        void brandingIsTenantScoped() {
            String tokenA = signIn(adminA);
            rest.exchange("/api/v1/branding", HttpMethod.PUT,
                    authorised(tokenA, Map.of(
                            "motto", "School A motto", "version", brandingVersion(tokenA))),
                    Map.class);

            ResponseEntity<Map> ofB = rest.exchange("/api/v1/branding", HttpMethod.GET,
                    authorised(signIn(adminB)), Map.class);

            assertThat(ofB.getBody().get("motto"))
                    .as("School B must not see School A's motto")
                    .isNotEqualTo("School A motto");
        }
    }

    // ===================================================================================

    private String signIn(Principal principal) {
        String token = "tok-" + principal.uid() + "-" + SEQ.getAndIncrement();
        identityTokens.accept(token, principal.uid(), principal.email(), true, false);

        ResponseEntity<Map> signIn = rest.postForEntity("/api/v1/sessions",
                json(Map.of("idToken", token)), Map.class);
        assertThat(signIn.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        String session = String.valueOf(signIn.getBody().get("sessionToken"));
        rest.exchange("/api/v1/sessions/current/membership", HttpMethod.POST,
                authorised(session, Map.of("membershipId", principal.membershipId().toString())),
                Void.class);
        return session;
    }

    private ResponseEntity<String> get(String token, String path) {
        return rest.exchange(path, HttpMethod.GET, authorised(token), String.class);
    }

    /**
     * Reads the current branding version, as a real client would before saving.
     *
     * <p>Hardcoding {@code 0} worked until the first test in this class saved successfully and
     * advanced it, after which every later save hit the optimistic lock. That was the lock doing
     * its job, not a defect — so the test reads first rather than the product being loosened.
     */
    private long brandingVersion(String token) {
        ResponseEntity<Map> current = rest.exchange(
                "/api/v1/branding", HttpMethod.GET, authorised(token), Map.class);
        assertThat(current.getStatusCode()).isEqualTo(HttpStatus.OK);
        Object version = current.getBody().get("version");
        return version instanceof Number number ? number.longValue() : 0L;
    }

    private ResponseEntity<CampusResponse> createCampus(String token) {
        int n = SEQ.getAndIncrement();
        return rest.exchange("/api/v1/campuses", HttpMethod.POST,
                authorised(token, newCampus("C" + n, "Campus " + n)), CampusResponse.class);
    }

    private static CreateCampusRequest newCampus(String code, String name) {
        return new CreateCampusRequest(code, name, "1 School Road", null, "Accra",
                "Greater Accra", null, "GH", "+233201234567", "campus@example.test",
                "Africa/Accra", LocalDate.of(2020, 1, 6));
    }

    private CampusResponse mainCampusFor(String token) {
        ResponseEntity<List<CampusResponse>> all = rest.exchange(
                "/api/v1/campuses", HttpMethod.GET, authorised(token),
                new ParameterizedTypeReference<>() { });
        List<CampusResponse> campuses = all.getBody();
        assertThat(campuses).isNotNull();
        if (campuses.stream().noneMatch(CampusResponse::main)) {
            CampusResponse created = createCampus(token).getBody();
            assertThat(created).isNotNull();
            return created;
        }
        return campuses.stream().filter(CampusResponse::main).findFirst().orElseThrow();
    }

    // ---- seeding ----------------------------------------------------------------------

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

    private static Principal principal(Connection c, UUID tenantId, String handle, String roleCode)
            throws SQLException {
        UUID userId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();
        String email = handle + "@example.test";

        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO identity.app_user
                    (id, firebase_uid, email, email_verified, full_name, status)
                VALUES (?, NULL, ?, false, ?, 'PENDING_INVITE')
                """)) {
            ps.setObject(1, userId);
            ps.setString(2, email);
            ps.setString(3, handle);
            ps.executeUpdate();
        }

        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO identity.membership
                    (id, tenant_id, user_id, status, principal_type, started_on)
                VALUES (?, ?, ?, 'ACTIVE', 'STAFF', current_date)
                """)) {
            ps.setObject(1, membershipId);
            ps.setObject(2, tenantId);
            ps.setObject(3, userId);
            ps.executeUpdate();
        }

        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO identity.membership_role (membership_id, role_id)
                SELECT ?, r.id FROM identity.role r
                 WHERE r.code = ? AND r.tenant_id IS NULL
                """)) {
            ps.setObject(1, membershipId);
            ps.setString(2, roleCode);
            if (ps.executeUpdate() != 1) {
                throw new IllegalStateException("System role " + roleCode + " not seeded");
            }
        }

        return new Principal(userId, membershipId, "firebase-" + handle, email);
    }
}
