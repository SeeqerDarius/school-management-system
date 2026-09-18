package io.sankofa.school.identity.application;

import io.sankofa.school.platform.config.SankofaProperties;
import io.sankofa.school.identity.auth.IdentityTokenVerifier;
import io.sankofa.school.identity.auth.IdentityTokenVerifier.VerifiedIdentity;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.platform.id.Ids;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Establishes, rebinds and revokes sessions.
 *
 * <p>The sign-in sequence, and why each step is there:
 *
 * <ol>
 *   <li><b>Verify the token</b> cryptographically. Until this succeeds nothing else happens —
 *       the uid in an unverified token is just a string the client chose.</li>
 *   <li><b>Resolve to a platform user</b> via {@code identity.resolve_login}, which either
 *       matches an existing account or claims a pending invitation. It never creates one:
 *       holding a Firebase account is not a route to a platform identity.</li>
 *   <li><b>Check the account is usable</b> — status, and the session cut-off that an
 *       administrative revocation advances.</li>
 *   <li><b>Mint an opaque session token.</b> 256 bits from {@link SecureRandom}. The database
 *       stores only its SHA-256, so a database read does not yield anything replayable.</li>
 *   <li><b>Return the memberships</b> without binding one. Choosing a school is a separate,
 *       authorized step.</li>
 * </ol>
 *
 * <p>No tenant is bound during any of this, which is exactly why steps 2 and 5 go through the
 * two {@code SECURITY DEFINER} functions in {@code V0005} rather than ordinary queries.
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    /** 256 bits. Long enough that guessing is not a threat model worth discussing. */
    private static final int TOKEN_BYTES = 32;

    private final IdentityTokenVerifier verifier;
    private final JdbcClient jdbc;
    private final SankofaProperties properties;
    private final SecureRandom random = new SecureRandom();

    public SessionService(IdentityTokenVerifier verifier, JdbcClient jdbc,
                          SankofaProperties properties) {
        this.verifier = verifier;
        this.jdbc = jdbc;
        this.properties = properties;
    }

    // ===================================================================================

    @Transactional
    public SignInResult signIn(String idToken, String ipAddress, String userAgent) {
        VerifiedIdentity identity = verifier.verify(idToken);

        LoginUser user = resolveLogin(identity)
                .orElseThrow(() -> {
                    // No account and no matching invitation. The message is identical to the
                    // one a wrong password produces, so this cannot be used to discover which
                    // email addresses belong to a school.
                    log.info("Sign-in refused: no platform account for the verified identity");
                    recordSecurityEvent(null, "SIGN_IN_REFUSED_NO_ACCOUNT", ipAddress, userAgent);
                    return new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
                });

        if (!"ACTIVE".equals(user.status())) {
            log.info("Sign-in refused for user {}: status is {}", user.userId(), user.status());
            recordSecurityEvent(user.userId(), "SIGN_IN_REFUSED_STATUS", ipAddress, userAgent);
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
        }

        // An administrator revoking sessions advances sessions_valid_from. A token minted
        // before that instant is no longer acceptable, even though it has not expired.
        if (identity.issuedAt().isBefore(user.sessionsValidFrom())) {
            log.info("Sign-in refused for user {}: token predates the session cut-off",
                    user.userId());
            recordSecurityEvent(user.userId(), "SIGN_IN_REFUSED_REVOKED", ipAddress, userAgent);
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Sign-in failed");
        }

        if (user.mfaRequired() && !identity.mfaSatisfied()) {
            // A distinct code here, unlike the others: the caller is who they claim to be and
            // needs to be told to enrol or present a second factor. Withholding that would just
            // strand them.
            log.info("Sign-in blocked for user {}: MFA required but not satisfied", user.userId());
            recordSecurityEvent(user.userId(), "SIGN_IN_BLOCKED_MFA", ipAddress, userAgent);
            throw new ApiException(ErrorCode.MFA_REQUIRED,
                    "Multi-factor authentication is required for this account");
        }

        String rawToken = mintToken();
        Instant expiresAt = Instant.now().plus(properties.session().ttl());
        UUID sessionId = Ids.newId();

        jdbc.sql("""
                INSERT INTO identity.user_session
                    (id, user_id, membership_id, token_hash, issued_at, expires_at,
                     ip_address, user_agent, mfa_satisfied)
                VALUES (:id, :userId, NULL, :tokenHash, now(), :expiresAt,
                        cast(:ip AS inet), :userAgent, :mfaSatisfied)
                """)
                .param("id", sessionId)
                .param("userId", user.userId())
                .param("tokenHash", sha256(rawToken))
                .param("expiresAt", OffsetDateTime.ofInstant(expiresAt, java.time.ZoneOffset.UTC))
                .param("ip", ipAddress)
                .param("userAgent", truncate(userAgent, 512))
                .param("mfaSatisfied", identity.mfaSatisfied())
                .update();

        // Through the SECURITY DEFINER writer: no context is bound yet, so a direct UPDATE
        // would be filtered by the app_user policy to zero rows — silently.
        jdbc.sql("SELECT identity.record_sign_in(:userId)")
                .param("userId", user.userId())
                .query(Void.class)
                .optional();

        recordSecurityEvent(user.userId(),
                user.newlyLinked() ? "ACCOUNT_LINKED" : "SIGN_IN_SUCCEEDED", ipAddress, userAgent);

        List<MembershipSummary> memberships = membershipsFor(user.userId());
        log.info("Sign-in succeeded for user {} with {} membership(s)",
                user.userId(), memberships.size());

        return new SignInResult(rawToken, expiresAt, user.userId(), memberships);
    }

    /**
     * Binds a session to one membership.
     *
     * <p>The membership is re-checked against the user here rather than trusted from the
     * request. This is the same guarantee {@code SessionResolver} enforces per request; doing
     * it at bind time as well means a stale or forged membership id never even reaches storage.
     */
    @Transactional
    public void selectMembership(String rawToken, UUID userId, UUID membershipId) {
        boolean belongsToUser = membershipsFor(userId).stream()
                .anyMatch(m -> m.membershipId().equals(membershipId));

        if (!belongsToUser) {
            log.warn("User {} attempted to bind membership {}, which they do not hold",
                    userId, membershipId);
            // NOT_FOUND rather than FORBIDDEN: confirming that the membership exists but
            // belongs to someone else is itself a disclosure.
            throw ApiException.notFound("Membership");
        }

        // Keyed on the token hash and the user together. Either alone would be enough here,
        // but the pair means a session can only ever be rebound by the principal holding it.
        jdbc.sql("""
                UPDATE identity.user_session
                   SET membership_id = :membershipId, last_seen_at = now()
                 WHERE token_hash = :tokenHash AND user_id = :userId AND revoked_at IS NULL
                """)
                .param("membershipId", membershipId)
                .param("tokenHash", sha256(rawToken))
                .param("userId", userId)
                .update();
    }

    @Transactional
    public void revoke(String rawToken, String reason) {
        jdbc.sql("""
                UPDATE identity.user_session
                   SET revoked_at = now(), revoked_reason = :reason
                 WHERE token_hash = :tokenHash AND revoked_at IS NULL
                """)
                .param("tokenHash", sha256(rawToken))
                .param("reason", truncate(reason, 200))
                .update();
    }

    /**
     * Revokes every outstanding session for a user, immediately.
     *
     * <p>Advancing {@code sessions_valid_from} is the important half: it invalidates identity
     * tokens already minted by the provider, which would otherwise keep working until they
     * expired. Deleting session rows alone would not stop a fresh sign-in with an old token.
     */
    @Transactional
    public int revokeAllForUser(UUID userId, String reason) {
        jdbc.sql("UPDATE identity.app_user SET sessions_valid_from = now() WHERE id = :id")
                .param("id", userId)
                .update();

        return jdbc.sql("""
                UPDATE identity.user_session
                   SET revoked_at = now(), revoked_reason = :reason
                 WHERE user_id = :userId AND revoked_at IS NULL
                """)
                .param("userId", userId)
                .param("reason", truncate(reason, 200))
                .update();
    }

    // ===================================================================================

    private Optional<LoginUser> resolveLogin(VerifiedIdentity identity) {
        return jdbc.sql("""
                SELECT user_id, status, sessions_valid_from, mfa_required, newly_linked
                  FROM identity.resolve_login(:uid, :email, :emailVerified)
                """)
                .param("uid", identity.uid())
                .param("email", identity.email() == null ? "" : identity.email())
                .param("emailVerified", identity.emailVerified())
                .query((rs, rowNum) -> new LoginUser(
                        rs.getObject("user_id", UUID.class),
                        rs.getString("status"),
                        rs.getObject("sessions_valid_from", OffsetDateTime.class).toInstant(),
                        rs.getBoolean("mfa_required"),
                        rs.getBoolean("newly_linked")))
                .optional();
    }

    private List<MembershipSummary> membershipsFor(UUID userId) {
        return jdbc.sql("""
                SELECT membership_id, tenant_id, tenant_slug, tenant_name, principal_type
                  FROM identity.memberships_for_user(:userId)
                """)
                .param("userId", userId)
                .query((rs, rowNum) -> new MembershipSummary(
                        rs.getObject("membership_id", UUID.class),
                        rs.getObject("tenant_id", UUID.class),
                        rs.getString("tenant_slug"),
                        rs.getString("tenant_name"),
                        rs.getString("principal_type")))
                .list();
    }

    /**
     * Records a sign-in outcome.
     *
     * <p>Goes through {@code identity.record_security_event} rather than an INSERT, because at
     * the point a sign-in is <em>refused</em> there is no current user and no current tenant —
     * which is precisely the row the RLS write policy would reject, and precisely the row most
     * worth having when someone is credential-stuffing a school's parent accounts.
     *
     * <p>Never carries a token, a password or a session identifier. See the logging deny-list
     * in {@code docs/SECURITY.md}.
     */
    private void recordSecurityEvent(UUID userId, String eventType, String ip, String userAgent) {
        jdbc.sql("""
                SELECT identity.record_security_event(
                    :userId, NULL, :eventType, :severity, :ip, :userAgent)
                """)
                .param("userId", userId)
                .param("eventType", eventType)
                .param("severity", eventType.contains("REFUSED") || eventType.contains("BLOCKED")
                        ? "NOTICE" : "INFO")
                .param("ip", ip)
                .param("userAgent", truncate(userAgent, 512))
                .query(UUID.class)
                .optional();
    }

    private String mintToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required and was not available", e);
        }
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }

    // ===================================================================================

    public record SignInResult(
            String sessionToken,
            Instant expiresAt,
            UUID userId,
            List<MembershipSummary> memberships) {
    }

    public record MembershipSummary(
            UUID membershipId,
            UUID tenantId,
            String tenantSlug,
            String tenantName,
            String principalType) {
    }

    private record LoginUser(
            UUID userId,
            String status,
            Instant sessionsValidFrom,
            boolean mfaRequired,
            boolean newlyLinked) {
    }
}
