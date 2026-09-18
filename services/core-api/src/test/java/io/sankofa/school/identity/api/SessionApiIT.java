package io.sankofa.school.identity.api;

import io.sankofa.school.identity.authz.Permissions;
import io.sankofa.school.testsupport.AbstractApiIT;
import io.sankofa.school.testsupport.TestDatabase;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The sign-in journey, end to end over HTTP: verify a token, resolve a platform user, choose a
 * school, act, sign out.
 *
 * <p>Two properties matter more than the happy path, and both are asserted here:
 * <ul>
 *   <li>Holding a valid identity-provider account is <b>not</b> a route to a platform identity.
 *       An unknown email is refused rather than silently provisioned.</li>
 *   <li>A user cannot bind a membership they do not hold, even naming its id exactly.</li>
 * </ul>
 */
class SessionApiIT extends AbstractApiIT {

    private static UUID tenantId;
    private static UUID invitedUserId;
    private static UUID membershipId;
    private static UUID otherUserId;
    private static UUID otherMembershipId;

    private static final String INVITED_EMAIL = "ama.mensah@greenfield.example";
    private static final String INVITED_UID = "firebase-uid-ama";
    private static final String OTHER_EMAIL = "kofi.asante@greenfield.example";
    private static final String OTHER_UID = "firebase-uid-kofi";

    @BeforeAll
    static void seed() throws SQLException {
        TestDatabase.start();
        tenantId = UUID.randomUUID();
        invitedUserId = UUID.randomUUID();
        membershipId = UUID.randomUUID();
        otherUserId = UUID.randomUUID();
        otherMembershipId = UUID.randomUUID();

        try (Connection c = TestDatabase.migrateConnection()) {
            insertTenant(c, tenantId, "greenfield-sessions", "Greenfield International School");

            // Invited, not yet linked to a credential — the state a school's admin leaves a new
            // member of staff in.
            insertInvitedUser(c, invitedUserId, INVITED_EMAIL, "Ama Mensah");
            insertMembership(c, membershipId, tenantId, invitedUserId, "TEACHER");
            grantSystemRole(c, membershipId, "TEACHER");

            insertInvitedUser(c, otherUserId, OTHER_EMAIL, "Kofi Asante");
            insertMembership(c, otherMembershipId, tenantId, otherUserId, "STAFF");
            grantSystemRole(c, otherMembershipId, "BURSAR");
        }
    }

    // ===================================================================================

    @Test
    @DisplayName("an invited user signs in, chooses a school, is recognised, and signs out")
    void fullSignInJourney() {
        identityTokens.accept("token-ama", INVITED_UID, INVITED_EMAIL, true, false);

        // --- sign in -------------------------------------------------------------------
        ResponseEntity<SessionController.SignInResponse> signIn = rest.postForEntity(
                "/api/v1/sessions",
                json(new SessionController.SignInRequest("token-ama")),
                SessionController.SignInResponse.class);

        assertThat(signIn.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        SessionController.SignInResponse body = signIn.getBody();
        assertThat(body).isNotNull();
        assertThat(body.sessionToken()).isNotBlank();
        assertThat(body.expiresAt()).isNotNull();

        // The invitation is claimed and the school appears — but no tenant is bound yet.
        assertThat(body.memberships()).hasSize(1);
        assertThat(body.memberships().getFirst().schoolSlug()).isEqualTo("greenfield-sessions");
        assertThat(body.memberships().getFirst().principalType()).isEqualTo("TEACHER");

        String session = body.sessionToken();

        // --- before choosing a school, there is no tenant --------------------------------
        ResponseEntity<SessionController.CurrentSessionResponse> beforeSelect = rest.exchange(
                "/api/v1/sessions/current", HttpMethod.GET, authorised(session),
                SessionController.CurrentSessionResponse.class);

        assertThat(beforeSelect.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(beforeSelect.getBody()).isNotNull();
        assertThat(beforeSelect.getBody().tenantId())
                .as("signing in must not implicitly choose a school")
                .isNull();

        // --- choose the school ----------------------------------------------------------
        ResponseEntity<Void> select = rest.exchange(
                "/api/v1/sessions/current/membership", HttpMethod.POST,
                authorised(session, new SessionController.SelectMembershipRequest(membershipId)),
                Void.class);
        assertThat(select.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // --- now the tenant and the permissions are bound ---------------------------------
        ResponseEntity<SessionController.CurrentSessionResponse> current = rest.exchange(
                "/api/v1/sessions/current", HttpMethod.GET, authorised(session),
                SessionController.CurrentSessionResponse.class);

        assertThat(current.getStatusCode()).isEqualTo(HttpStatus.OK);
        SessionController.CurrentSessionResponse me = current.getBody();
        assertThat(me).isNotNull();
        assertThat(me.tenantId()).isEqualTo(tenantId);
        assertThat(me.membershipId()).isEqualTo(membershipId);
        assertThat(me.supportSession()).isFalse();

        // Permissions come from the seeded TEACHER role, resolved by SQL.
        assertThat(me.permissions())
                .contains(Permissions.ATTENDANCE_MARK, Permissions.GRADE_ENTER,
                        Permissions.GRADE_SUBMIT)
                .as("a teacher must not acquire approval, payroll or ledger rights by signing in")
                .doesNotContain(Permissions.GRADE_APPROVE, Permissions.PAYROLL_APPROVE,
                        Permissions.ACCOUNTING_JOURNAL_POST);

        // --- sign out --------------------------------------------------------------------
        ResponseEntity<Void> signOut = rest.exchange(
                "/api/v1/sessions/current", HttpMethod.DELETE, authorised(session), Void.class);
        assertThat(signOut.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // --- the token is dead immediately ------------------------------------------------
        ResponseEntity<String> afterSignOut = rest.exchange(
                "/api/v1/sessions/current", HttpMethod.GET, authorised(session), String.class);
        assertThat(afterSignOut.getStatusCode())
                .as("a revoked session must stop working at once, not at expiry")
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a second sign-in works once the account is already linked")
    void returningUserSignsIn() {
        identityTokens.accept("token-kofi-1", OTHER_UID, OTHER_EMAIL, true, false);
        rest.postForEntity("/api/v1/sessions",
                json(new SessionController.SignInRequest("token-kofi-1")),
                SessionController.SignInResponse.class);

        // Second time through takes the returning-user path: matched on uid, not on invitation.
        identityTokens.accept("token-kofi-2", OTHER_UID, OTHER_EMAIL, true, false);
        ResponseEntity<SessionController.SignInResponse> again = rest.postForEntity(
                "/api/v1/sessions",
                json(new SessionController.SignInRequest("token-kofi-2")),
                SessionController.SignInResponse.class);

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(again.getBody()).isNotNull();
        assertThat(again.getBody().memberships()).hasSize(1);
    }

    // ===================================================================================
    // Refusals
    // ===================================================================================

    @Test
    @DisplayName("a verified identity with no platform account is refused, not provisioned")
    void unknownIdentityIsRefused() {
        // The critical property: a valid Firebase account is not a route into a school.
        // Anyone can create one; only a school can issue an invitation.
        identityTokens.accept("token-stranger", "firebase-uid-stranger",
                "stranger@example.com", true, false);

        ResponseEntity<Map> response = rest.postForEntity("/api/v1/sessions",
                json(new SessionController.SignInRequest("token-stranger")), Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody()).containsEntry("code", "UNAUTHENTICATED");
    }

    @Test
    @DisplayName("an unverifiable token is refused")
    void unverifiableTokenIsRefused() {
        ResponseEntity<Map> response = rest.postForEntity("/api/v1/sessions",
                json(new SessionController.SignInRequest("not-a-real-token")), Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a missing token is a validation error, not a server error")
    void missingTokenIsRejected() {
        ResponseEntity<Map> response = rest.postForEntity("/api/v1/sessions",
                json(new SessionController.SignInRequest("")), Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "VALIDATION_ERROR");
    }

    @Test
    @DisplayName("a user cannot bind a membership belonging to someone else")
    void cannotBindAnotherUsersMembership() {
        identityTokens.accept("token-ama-2", INVITED_UID, INVITED_EMAIL, true, false);
        ResponseEntity<SessionController.SignInResponse> signIn = rest.postForEntity(
                "/api/v1/sessions", json(new SessionController.SignInRequest("token-ama-2")),
                SessionController.SignInResponse.class);
        String session = signIn.getBody().sessionToken();

        // Ama names Kofi's membership id exactly. Same school, so a tenant check alone would
        // not catch it — the membership must be checked against the principal.
        ResponseEntity<Map> response = rest.exchange(
                "/api/v1/sessions/current/membership", HttpMethod.POST,
                authorised(session,
                        new SessionController.SelectMembershipRequest(otherMembershipId)),
                Map.class);

        assertThat(response.getStatusCode())
                .as("NOT_FOUND, not FORBIDDEN: confirming the membership exists would itself "
                        + "disclose something")
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("an unauthenticated request to a protected endpoint is refused")
    void unauthenticatedRequestIsRefused() {
        ResponseEntity<String> response = rest.getForEntity(
                "/api/v1/sessions/current", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a forged session token is refused")
    void forgedTokenIsRefused() {
        ResponseEntity<String> response = rest.exchange(
                "/api/v1/sessions/current", HttpMethod.GET,
                authorised("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("no error response carries a stack trace or an internal type name")
    void errorsDoNotLeakInternals() {
        ResponseEntity<String> response = rest.postForEntity("/api/v1/sessions",
                json(new SessionController.SignInRequest("nope")), String.class);

        assertThat(response.getBody())
                .doesNotContain("java.", "org.springframework", "Exception", "at io.sankofa");
    }

    // ===================================================================================

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

    private static void insertInvitedUser(Connection c, UUID id, String email, String name)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO identity.app_user
                    (id, firebase_uid, email, email_verified, full_name, status)
                VALUES (?, NULL, ?, false, ?, 'PENDING_INVITE')
                """)) {
            ps.setObject(1, id);
            ps.setString(2, email);
            ps.setString(3, name);
            ps.executeUpdate();
        }
    }

    private static void insertMembership(Connection c, UUID id, UUID tenant, UUID user,
                                         String principalType) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO identity.membership
                    (id, tenant_id, user_id, status, principal_type, started_on)
                VALUES (?, ?, ?, 'ACTIVE', ?, current_date)
                """)) {
            ps.setObject(1, id);
            ps.setObject(2, tenant);
            ps.setObject(3, user);
            ps.setString(4, principalType);
            ps.executeUpdate();
        }
    }

    private static void grantSystemRole(Connection c, UUID membership, String roleCode)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO identity.membership_role (membership_id, role_id)
                SELECT ?, r.id FROM identity.role r
                 WHERE r.code = ? AND r.tenant_id IS NULL
                """)) {
            ps.setObject(1, membership);
            ps.setString(2, roleCode);
            int rows = ps.executeUpdate();
            if (rows != 1) {
                throw new IllegalStateException(
                        "System role " + roleCode + " was not found; the V0003 seed did not run");
            }
        }
    }
}
