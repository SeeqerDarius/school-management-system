package io.sankofa.school.school.api;

import io.sankofa.school.school.api.AcademicYearController.AcademicYearResponse;
import io.sankofa.school.school.api.AcademicYearController.CreateAcademicYearRequest;
import io.sankofa.school.school.api.AcademicYearController.CreateTermRequest;
import io.sankofa.school.school.api.AcademicYearController.ReasonRequest;
import io.sankofa.school.school.api.AcademicYearController.TermResponse;
import io.sankofa.school.school.api.AcademicYearController.UpdateAcademicYearRequest;
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
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The academic calendar over real HTTP — and the reference integration test for every module
 * that follows.
 *
 * <p>It covers the five things AGENTS.md §7 requires of a business module, in one file:
 * cross-tenant isolation, the permission matrix in both directions, the state machine including
 * an illegal transition, the database constraints that application code cannot enforce under
 * concurrency, and the audit entries that sensitive actions must leave behind.
 */
class AcademicCalendarApiIT extends AbstractApiIT {

    private static final String SCHOOL_A_SLUG = "greenfield-calendar";
    private static final String SCHOOL_B_SLUG = "akosombo-calendar";

    // Three principals in School A, chosen to make the permission matrix meaningful:
    // SCHOOL_ADMIN holds view + manage, HEADMASTER holds view only, TEACHER holds neither.
    private static Principal adminA;
    private static Principal headA;
    private static Principal teacherA;
    private static Principal adminB;

    private static UUID tenantA;
    private static UUID tenantB;

    /** Keeps generated year codes unique so tests do not collide on the code index. */
    private static final AtomicInteger SEQ = new AtomicInteger(1);

    private record Principal(UUID userId, UUID membershipId, String uid, String email) {
    }

    @BeforeAll
    static void seed() throws SQLException {
        TestDatabase.start();
        tenantA = UUID.randomUUID();
        tenantB = UUID.randomUUID();

        try (Connection c = TestDatabase.migrateConnection()) {
            insertTenant(c, tenantA, SCHOOL_A_SLUG, "Greenfield International School");
            insertTenant(c, tenantB, SCHOOL_B_SLUG, "Akosombo Model Academy");

            adminA = principal(c, tenantA, "cal-admin-a", "SCHOOL_ADMIN", "STAFF");
            headA = principal(c, tenantA, "cal-head-a", "HEADMASTER", "STAFF");
            teacherA = principal(c, tenantA, "cal-teacher-a", "TEACHER", "TEACHER");
            adminB = principal(c, tenantB, "cal-admin-b", "SCHOOL_ADMIN", "STAFF");
        }
    }

    // ===================================================================================

    @Nested
    @DisplayName("permission matrix")
    class PermissionMatrix {

        @Test
        @DisplayName("an administrator may list and create")
        void adminMayManage() {
            String token = signIn(adminA);

            assertThat(get(token, "/api/v1/academic-years").getStatusCode())
                    .isEqualTo(HttpStatus.OK);
            assertThat(createYear(token).getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        @DisplayName("a headmaster may list but not create")
        void headMayViewNotManage() {
            String token = signIn(headA);

            // ACADEMIC_YEAR_VIEW without ACADEMIC_YEAR_MANAGE. Read and write are separate
            // permissions precisely so this distinction is expressible.
            assertThat(get(token, "/api/v1/academic-years").getStatusCode())
                    .isEqualTo(HttpStatus.OK);
            assertThat(createYear(token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        @DisplayName("a teacher may do neither")
        void teacherMayNeither() {
            String token = signIn(teacherA);

            // Teaching is not a reason to see or change the school's calendar.
            assertThat(get(token, "/api/v1/academic-years").getStatusCode())
                    .isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(createYear(token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        @DisplayName("an unauthenticated request is refused")
        void anonymousRefused() {
            assertThat(rest.getForEntity("/api/v1/academic-years", String.class).getStatusCode())
                    .isEqualTo(HttpStatus.UNAUTHORIZED);
        }
    }

    // ===================================================================================

    @Nested
    @DisplayName("tenant isolation")
    class TenantIsolation {

        @Test
        @DisplayName("one school cannot see, read or change another school's academic year")
        void schoolBCannotReachSchoolAsYear() {
            String tokenA = signIn(adminA);
            AcademicYearResponse created = createYear(tokenA).getBody();
            assertThat(created).isNotNull();

            String tokenB = signIn(adminB);

            // Not in the list...
            ResponseEntity<List<AcademicYearResponse>> listB = rest.exchange(
                    "/api/v1/academic-years", HttpMethod.GET, authorised(tokenB),
                    new ParameterizedTypeReference<>() { });
            assertThat(listB.getBody())
                    .as("School B's list must not contain School A's year")
                    .noneMatch(y -> y.id().equals(created.id()));

            // ...and not reachable by naming its id directly. 404, not 403: confirming the row
            // exists elsewhere would itself be a disclosure.
            assertThat(get(tokenB, "/api/v1/academic-years/" + created.id()).getStatusCode())
                    .isEqualTo(HttpStatus.NOT_FOUND);

            // ...and not mutable either. A read-only isolation test would miss this.
            ResponseEntity<String> activate = rest.exchange(
                    "/api/v1/academic-years/" + created.id() + "/activate", HttpMethod.POST,
                    authorised(tokenB, null), String.class);
            assertThat(activate.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        }

        @Test
        @DisplayName("both schools may use the same year code without colliding")
        void identicalCodesCoexistAcrossTenants() {
            String code = "SHARED-" + SEQ.getAndIncrement();

            ResponseEntity<AcademicYearResponse> a = rest.exchange(
                    "/api/v1/academic-years", HttpMethod.POST,
                    authorised(signIn(adminA), new CreateAcademicYearRequest(
                            code, "Shared code year",
                            LocalDate.of(2030, 9, 1), LocalDate.of(2031, 7, 31))),
                    AcademicYearResponse.class);

            ResponseEntity<AcademicYearResponse> b = rest.exchange(
                    "/api/v1/academic-years", HttpMethod.POST,
                    authorised(signIn(adminB), new CreateAcademicYearRequest(
                            code, "Shared code year",
                            LocalDate.of(2030, 9, 1), LocalDate.of(2031, 7, 31))),
                    AcademicYearResponse.class);

            // Uniqueness is scoped per tenant, not globally. Two schools naming their year
            // "2030/2031" is the normal case, not a conflict.
            assertThat(a.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            assertThat(b.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }
    }

    // ===================================================================================

    @Nested
    @DisplayName("lifecycle")
    class Lifecycle {

        @Test
        @DisplayName("a year moves planned to active to closed, and terms follow")
        void fullLifecycle() {
            String token = signIn(adminA);

            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();
            assertThat(year.status()).isEqualTo("PLANNED");
            assertThat(year.editable()).isTrue();
            assertThat(year.allowedTransitions()).containsExactly("ACTIVE", "CLOSED");

            // A term inside the year.
            ResponseEntity<TermResponse> term = rest.exchange(
                    "/api/v1/academic-years/" + year.id() + "/terms", HttpMethod.POST,
                    authorised(token, new CreateTermRequest("T1", "First Term",
                            year.startsOn(), year.startsOn().plusMonths(3), null, null)),
                    TermResponse.class);
            assertThat(term.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            assertThat(term.getBody()).isNotNull();
            assertThat(term.getBody().sequence()).isEqualTo(1);

            // A term cannot go into use before the year containing it.
            ResponseEntity<Map> earlyActivate = rest.exchange(
                    "/api/v1/terms/" + term.getBody().id() + "/activate", HttpMethod.POST,
                    authorised(token, null), Map.class);
            assertThat(earlyActivate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(earlyActivate.getBody()).containsEntry("code", "INVALID_STATE_TRANSITION");

            // Activate the year, then the term.
            AcademicYearResponse active = post(token,
                    "/api/v1/academic-years/" + year.id() + "/activate",
                    AcademicYearResponse.class).getBody();
            assertThat(active).isNotNull();
            assertThat(active.status()).isEqualTo("ACTIVE");
            assertThat(active.editable())
                    .as("an active year's dates are no longer freely editable")
                    .isFalse();

            TermResponse activeTerm = post(token,
                    "/api/v1/terms/" + term.getBody().id() + "/activate",
                    TermResponse.class).getBody();
            assertThat(activeTerm).isNotNull();
            assertThat(activeTerm.status()).isEqualTo("ACTIVE");

            // A year cannot close while a term is still open.
            ResponseEntity<Map> earlyClose = rest.exchange(
                    "/api/v1/academic-years/" + year.id() + "/close", HttpMethod.POST,
                    authorised(token, new ReasonRequest("End of session")), Map.class);
            assertThat(earlyClose.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

            // Close the term, then the year.
            ResponseEntity<TermResponse> closedTerm = rest.exchange(
                    "/api/v1/terms/" + term.getBody().id() + "/close", HttpMethod.POST,
                    authorised(token, new ReasonRequest("Term completed")), TermResponse.class);
            assertThat(closedTerm.getStatusCode()).isEqualTo(HttpStatus.OK);

            ResponseEntity<AcademicYearResponse> closedYear = rest.exchange(
                    "/api/v1/academic-years/" + year.id() + "/close", HttpMethod.POST,
                    authorised(token, new ReasonRequest("Session ended")),
                    AcademicYearResponse.class);
            assertThat(closedYear.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(closedYear.getBody()).isNotNull();
            assertThat(closedYear.getBody().status()).isEqualTo("CLOSED");
            assertThat(closedYear.getBody().allowedTransitions())
                    .as("CLOSED is terminal — there is no route back")
                    .isEmpty();
        }

        @Test
        @DisplayName("closing requires a reason")
        void closingRequiresReason() {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            ResponseEntity<Map> blank = rest.exchange(
                    "/api/v1/academic-years/" + year.id() + "/close", HttpMethod.POST,
                    authorised(token, new ReasonRequest("")), Map.class);
            assertThat(blank.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(blank.getBody()).containsEntry("code", "VALIDATION_ERROR");
        }

        @Test
        @DisplayName("a closed year cannot be reopened")
        void closedYearCannotReopen() {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            rest.exchange("/api/v1/academic-years/" + year.id() + "/close", HttpMethod.POST,
                    authorised(token, new ReasonRequest("Closed for test")), String.class);

            // Reopening would retroactively change what an already-issued report card means.
            ResponseEntity<Map> reopen = rest.exchange(
                    "/api/v1/academic-years/" + year.id() + "/activate", HttpMethod.POST,
                    authorised(token, null), Map.class);
            assertThat(reopen.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(reopen.getBody()).containsEntry("code", "INVALID_STATE_TRANSITION");
        }

        @Test
        @DisplayName("an active year's dates can no longer be edited")
        void activeYearDatesAreFrozen() {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            AcademicYearResponse active = post(token,
                    "/api/v1/academic-years/" + year.id() + "/activate",
                    AcademicYearResponse.class).getBody();
            assertThat(active).isNotNull();

            // Attendance and marks already reference this year; moving its boundaries would
            // silently re-scope data that has been reported on.
            ResponseEntity<Map> edit = rest.exchange(
                    "/api/v1/academic-years/" + year.id(), HttpMethod.PUT,
                    authorised(token, new UpdateAcademicYearRequest(
                            active.code(), "Renamed", active.startsOn(),
                            active.endsOn().plusDays(30), active.version())),
                    Map.class);
            assertThat(edit.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        }

        @Test
        @DisplayName("only an active year can be made current")
        void onlyActiveYearCanBeCurrent() {
            String token = signIn(adminA);
            AcademicYearResponse planned = createYear(token).getBody();
            assertThat(planned).isNotNull();

            assertThat(rest.exchange(
                    "/api/v1/academic-years/" + planned.id() + "/make-current", HttpMethod.POST,
                    authorised(token, null), Map.class).getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT);

            post(token, "/api/v1/academic-years/" + planned.id() + "/activate",
                    AcademicYearResponse.class);
            ResponseEntity<AcademicYearResponse> madeCurrent = post(token,
                    "/api/v1/academic-years/" + planned.id() + "/make-current",
                    AcademicYearResponse.class);

            assertThat(madeCurrent.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(madeCurrent.getBody()).isNotNull();
            assertThat(madeCurrent.getBody().current()).isTrue();
        }
    }

    // ===================================================================================

    @Nested
    @DisplayName("constraints the database enforces")
    class Constraints {

        @Test
        @DisplayName("overlapping academic years are refused")
        void overlappingYearsRefused() {
            String token = signIn(adminA);

            ResponseEntity<AcademicYearResponse> first = rest.exchange(
                    "/api/v1/academic-years", HttpMethod.POST,
                    authorised(token, new CreateAcademicYearRequest(
                            "OV-" + SEQ.getAndIncrement(), "Overlap base",
                            LocalDate.of(2040, 9, 1), LocalDate.of(2041, 7, 31))),
                    AcademicYearResponse.class);
            assertThat(first.getStatusCode()).isEqualTo(HttpStatus.CREATED);

            // Overlaps by a single day. An exclusion constraint catches this even when two
            // administrators submit simultaneously, which a read-then-check never could.
            ResponseEntity<Map> overlapping = rest.exchange(
                    "/api/v1/academic-years", HttpMethod.POST,
                    authorised(token, new CreateAcademicYearRequest(
                            "OV-" + SEQ.getAndIncrement(), "Overlapping",
                            LocalDate.of(2041, 7, 31), LocalDate.of(2042, 6, 30))),
                    Map.class);

            assertThat(overlapping.getStatusCode())
                    .as("an overlapping academic year is a user error, not a server error")
                    .isEqualTo(HttpStatus.CONFLICT);
            assertThat(overlapping.getBody()).containsEntry("code", "CONFLICT");
            assertThat(String.valueOf(overlapping.getBody().get("message")))
                    .contains("overlaps");
        }

        @Test
        @DisplayName("a duplicate year code within the same school is refused by field")
        void duplicateCodeRefused() {
            String token = signIn(adminA);
            String code = "DUP-" + SEQ.getAndIncrement();

            rest.exchange("/api/v1/academic-years", HttpMethod.POST,
                    authorised(token, new CreateAcademicYearRequest(code, "First",
                            LocalDate.of(2045, 9, 1), LocalDate.of(2046, 7, 31))),
                    AcademicYearResponse.class);

            ResponseEntity<Map> duplicate = rest.exchange(
                    "/api/v1/academic-years", HttpMethod.POST,
                    authorised(token, new CreateAcademicYearRequest(code, "Second",
                            LocalDate.of(2050, 9, 1), LocalDate.of(2051, 7, 31))),
                    Map.class);

            assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(duplicate.getBody()).containsEntry("code", "VALIDATION_ERROR");
            // Named on the field, so the UI can put the message beside the input rather than
            // in a banner the user has to map back to a form control themselves.
            assertThat(fieldErrors(duplicate.getBody())).containsKey("code");
        }

        @Test
        @DisplayName("a term outside its academic year is refused with an actionable message")
        void termOutsideYearRefused() {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            ResponseEntity<Map> outside = rest.exchange(
                    "/api/v1/academic-years/" + year.id() + "/terms", HttpMethod.POST,
                    authorised(token, new CreateTermRequest("BAD", "Outside",
                            year.endsOn().minusDays(10), year.endsOn().plusMonths(2),
                            null, null)),
                    Map.class);

            assertThat(outside.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(String.valueOf(outside.getBody().get("message")))
                    .contains("ends after the academic year");
        }

        @Test
        @DisplayName("a stale version is refused rather than overwriting someone else's edit")
        void staleVersionRefused() {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            // First edit succeeds and advances the version.
            rest.exchange("/api/v1/academic-years/" + year.id(), HttpMethod.PUT,
                    authorised(token, new UpdateAcademicYearRequest(year.code(), "Renamed once",
                            year.startsOn(), year.endsOn(), year.version())),
                    AcademicYearResponse.class);

            // Second edit replays the original version: another administrator's change would
            // otherwise be silently overwritten by someone who never saw it.
            ResponseEntity<Map> stale = rest.exchange(
                    "/api/v1/academic-years/" + year.id(), HttpMethod.PUT,
                    authorised(token, new UpdateAcademicYearRequest(year.code(), "Renamed twice",
                            year.startsOn(), year.endsOn(), year.version())),
                    Map.class);

            assertThat(stale.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(stale.getBody()).containsEntry("code", "OPTIMISTIC_LOCK");
        }
    }

    // ===================================================================================

    @Nested
    @DisplayName("audit")
    class Audit {

        @Test
        @DisplayName("closing a year records the actor, the action and the stated reason")
        void closingIsAudited() throws SQLException {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            String reason = "Session ended early because of the national census";
            rest.exchange("/api/v1/academic-years/" + year.id() + "/close", HttpMethod.POST,
                    authorised(token, new ReasonRequest(reason)), String.class);

            Map<String, Object> entry = latestAuditEntry("ACADEMIC_YEAR_CLOSED", year.id());

            assertThat(entry).as("closing a year must leave an audit entry").isNotNull();
            assertThat(entry.get("tenant_id")).isEqualTo(tenantA);
            assertThat(entry.get("actor_user_id")).isEqualTo(adminA.userId());
            assertThat(entry.get("resource_ref")).isEqualTo(year.code());
            // Six months later, "who closed it" is far less useful than "and why".
            assertThat(entry.get("reason")).isEqualTo(reason);
            assertThat(entry.get("correlation_id")).isNotNull();
        }

        @Test
        @DisplayName("creating a year records what was created")
        void creationIsAudited() throws SQLException {
            String token = signIn(adminA);
            AcademicYearResponse year = createYear(token).getBody();
            assertThat(year).isNotNull();

            Map<String, Object> entry = latestAuditEntry("ACADEMIC_YEAR_CREATED", year.id());
            assertThat(entry).isNotNull();
            assertThat(String.valueOf(entry.get("after_value")))
                    .contains(year.code())
                    .contains(year.startsOn().toString());
        }

        @Test
        @DisplayName("a school sees only its own audit entries")
        void auditIsTenantScoped() throws SQLException {
            String tokenA = signIn(adminA);
            AcademicYearResponse yearA = createYear(tokenA).getBody();
            assertThat(yearA).isNotNull();

            try (Connection c = TestDatabase.appConnection()) {
                bindTenant(c, tenantB);
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT count(*) FROM audit.audit_log WHERE resource_id = ?")) {
                    ps.setObject(1, yearA.id());
                    try (ResultSet rs = ps.executeQuery()) {
                        rs.next();
                        assertThat(rs.getLong(1))
                                .as("School B must not see audit entries for School A's records")
                                .isZero();
                    }
                }
            }
        }
    }

    // ===================================================================================
    // Helpers
    // ===================================================================================

    private String signIn(Principal principal) {
        String token = "tok-" + principal.uid() + "-" + SEQ.getAndIncrement();
        identityTokens.accept(token, principal.uid(), principal.email(), true, false);

        ResponseEntity<Map> signIn = rest.postForEntity("/api/v1/sessions",
                json(Map.of("idToken", token)), Map.class);
        assertThat(signIn.getStatusCode())
                .as("sign-in for %s should succeed", principal.email())
                .isEqualTo(HttpStatus.CREATED);

        String session = String.valueOf(signIn.getBody().get("sessionToken"));

        ResponseEntity<Void> select = rest.exchange(
                "/api/v1/sessions/current/membership", HttpMethod.POST,
                authorised(session, Map.of("membershipId", principal.membershipId().toString())),
                Void.class);
        assertThat(select.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        return session;
    }

    private ResponseEntity<String> get(String token, String path) {
        return rest.exchange(path, HttpMethod.GET, authorised(token), String.class);
    }

    private <T> ResponseEntity<T> post(String token, String path, Class<T> type) {
        return rest.exchange(path, HttpMethod.POST, authorised(token, null), type);
    }

    private ResponseEntity<AcademicYearResponse> createYear(String token) {
        int n = SEQ.getAndIncrement();
        return rest.exchange("/api/v1/academic-years", HttpMethod.POST,
                authorised(token, new CreateAcademicYearRequest(
                        "AY-" + n, "Academic year " + n,
                        LocalDate.of(2060 + n, 9, 1), LocalDate.of(2061 + n, 7, 31))),
                AcademicYearResponse.class);
    }

    /** Pulls the per-field errors out of an {@code ApiError} body. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> fieldErrors(Map<?, ?> errorBody) {
        Object errors = errorBody.get("fieldErrors");
        return errors instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static void bindTenant(Connection c, UUID tenantId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT set_config('app.tenant_id', ?, false)")) {
            ps.setString(1, tenantId.toString());
            ps.execute();
        }
    }

    private static Map<String, Object> latestAuditEntry(String action, UUID resourceId)
            throws SQLException {
        try (Connection c = TestDatabase.migrateConnection();
             PreparedStatement ps = c.prepareStatement("""
                     SELECT tenant_id, actor_user_id, resource_ref, reason,
                            after_value::text AS after_value, correlation_id
                       FROM audit.audit_log
                      WHERE action = ? AND resource_id = ?
                      ORDER BY occurred_at DESC
                      LIMIT 1
                     """)) {
            ps.setString(1, action);
            ps.setObject(2, resourceId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return Map.of(
                        "tenant_id", rs.getObject("tenant_id", UUID.class),
                        "actor_user_id", rs.getObject("actor_user_id", UUID.class),
                        "resource_ref", String.valueOf(rs.getString("resource_ref")),
                        "reason", String.valueOf(rs.getString("reason")),
                        "after_value", String.valueOf(rs.getString("after_value")),
                        "correlation_id", String.valueOf(rs.getString("correlation_id")));
            }
        }
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

    private static Principal principal(Connection c, UUID tenantId, String handle,
                                       String roleCode, String principalType) throws SQLException {
        UUID userId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();
        String email = handle + "@example.test";
        String uid = "firebase-" + handle;

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
                VALUES (?, ?, ?, 'ACTIVE', ?, current_date)
                """)) {
            ps.setObject(1, membershipId);
            ps.setObject(2, tenantId);
            ps.setObject(3, userId);
            ps.setString(4, principalType);
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

        return new Principal(userId, membershipId, uid, email);
    }
}
