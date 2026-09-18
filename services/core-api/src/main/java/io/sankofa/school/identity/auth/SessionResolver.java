package io.sankofa.school.identity.auth;

import io.sankofa.school.tenancy.TenantContext;
import io.sankofa.school.tenancy.TenantContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Turns an opaque session token into a verified {@link TenantContext}.
 *
 * <h2>The bootstrapping problem</h2>
 * Row Level Security needs a tenant, but the tenant is not known until the session has been
 * resolved. Resolution therefore proceeds in three deliberate steps, each widening scope only
 * as far as the previous step justified:
 *
 * <ol>
 *   <li><b>Session lookup</b> by token hash. {@code identity.user_session} carries no RLS policy —
 *       it is keyed by a 256-bit secret, and an attacker who already holds a valid token has not
 *       been stopped by a tenant predicate anyway.</li>
 *   <li><b>Membership lookup</b> under a bootstrap context carrying only {@code user_id}. The
 *       {@code membership_self_read} policy lets a principal enumerate their own memberships and
 *       nothing else, so this step cannot see another user's schools.</li>
 *   <li><b>Permission resolution</b> for the single chosen membership.</li>
 * </ol>
 *
 * <p>The membership the caller asks for is always checked against the memberships the principal
 * actually holds. This is the single point at which "the browser cannot choose its tenant" is
 * enforced (Invariant I-1); everything downstream trusts the result.
 */
@Service
public class SessionResolver {

    private static final Logger log = LoggerFactory.getLogger(SessionResolver.class);

    private final JdbcClient jdbc;

    public SessionResolver(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param rawToken             the opaque bearer token presented by the caller
     * @param requestedMembership  the membership the caller wishes to act through, or
     *                             {@code null} to use the session's currently bound membership
     */
    public Optional<TenantContext> resolve(String rawToken, UUID requestedMembership) {
        if (rawToken == null || rawToken.isBlank()) {
            return Optional.empty();
        }

        SessionRow session = findSession(sha256(rawToken)).orElse(null);
        if (session == null) {
            return Optional.empty();
        }
        if (session.revokedAt() != null) {
            log.debug("Session {} rejected: revoked", session.id());
            return Optional.empty();
        }
        if (session.expiresAt().isBefore(Instant.now())) {
            log.debug("Session {} rejected: expired", session.id());
            return Optional.empty();
        }
        // A password change, MFA reset or administrative revocation advances
        // app_user.sessions_valid_from, cutting off every token issued before that instant.
        if (session.issuedAt().isBefore(session.sessionsValidFrom())) {
            log.info("Session {} rejected: issued before the account's session cut-off",
                    session.id());
            return Optional.empty();
        }
        if (!"ACTIVE".equals(session.userStatus())) {
            log.info("Session {} rejected: account status is {}", session.id(), session.userStatus());
            return Optional.empty();
        }

        UUID targetMembership = requestedMembership != null
                ? requestedMembership
                : session.membershipId();
        if (targetMembership == null) {
            // Signed in, but no school selected yet. Legitimate immediately after login.
            return Optional.of(bootstrapContext(session.userId()));
        }

        try {
            return TenantContextHolder.runAs(bootstrapContext(session.userId()),
                    () -> buildContext(session, targetMembership));
        } catch (Exception e) {
            log.error("Failed to resolve membership {} for session {}",
                    targetMembership, session.id(), e);
            return Optional.empty();
        }
    }

    private Optional<TenantContext> buildContext(SessionRow session, UUID membershipId) {
        // The WHERE clause names the user explicitly. RLS would also confine this, but the
        // predicate is written out so the intent is visible at the call site (AGENTS.md §5).
        Optional<MembershipRow> membership = jdbc.sql("""
                SELECT m.id, m.tenant_id, m.status, m.principal_type
                  FROM identity.membership m
                 WHERE m.id = :membershipId
                   AND m.user_id = :userId
                """)
                .param("membershipId", membershipId)
                .param("userId", session.userId())
                .query((rs, rowNum) -> new MembershipRow(
                        rs.getObject("id", UUID.class),
                        rs.getObject("tenant_id", UUID.class),
                        rs.getString("status"),
                        rs.getString("principal_type")))
                .optional();

        if (membership.isEmpty()) {
            // The caller asked to act as a membership that is not theirs. This is either a bug
            // in the web tier or a deliberate probe; either way it is worth a log line.
            log.warn("User {} attempted to act through membership {}, which they do not hold",
                    session.userId(), membershipId);
            return Optional.empty();
        }

        MembershipRow m = membership.get();
        if (!"ACTIVE".equals(m.status())) {
            log.info("Membership {} rejected: status is {}", m.id(), m.status());
            return Optional.empty();
        }

        Set<String> permissions = new HashSet<>(effectivePermissions(m.id()));

        return Optional.of(TenantContext.ofTenant(
                session.userId(), m.tenantId(), m.id(), permissions));
    }

    private List<String> effectivePermissions(UUID membershipId) {
        // One SQL definition of "effective", shared by the application and by the permission
        // tests, so there is no second implementation to drift out of agreement.
        return jdbc.sql("SELECT code FROM identity.effective_permissions(:membershipId)")
                .param("membershipId", membershipId)
                .query(String.class)
                .list();
    }

    private Optional<SessionRow> findSession(byte[] tokenHash) {
        return jdbc.sql("""
                SELECT s.id, s.user_id, s.membership_id, s.issued_at, s.expires_at,
                       s.revoked_at, s.mfa_satisfied,
                       u.status AS user_status, u.sessions_valid_from
                  FROM identity.user_session s
                  JOIN identity.app_user u ON u.id = s.user_id
                 WHERE s.token_hash = :tokenHash
                """)
                .param("tokenHash", tokenHash)
                .query((rs, rowNum) -> new SessionRow(
                        rs.getObject("id", UUID.class),
                        rs.getObject("user_id", UUID.class),
                        rs.getObject("membership_id", UUID.class),
                        rs.getObject("issued_at", java.time.OffsetDateTime.class).toInstant(),
                        rs.getObject("expires_at", java.time.OffsetDateTime.class).toInstant(),
                        rs.getObject("revoked_at", java.time.OffsetDateTime.class) == null
                                ? null
                                : rs.getObject("revoked_at", java.time.OffsetDateTime.class).toInstant(),
                        rs.getBoolean("mfa_satisfied"),
                        rs.getString("user_status"),
                        rs.getObject("sessions_valid_from", java.time.OffsetDateTime.class).toInstant()))
                .optional();
    }

    /** A context that identifies the principal but grants no tenant access. */
    private static TenantContext bootstrapContext(UUID userId) {
        return new TenantContext(userId, null, null, Set.of(), false, null);
    }

    /**
     * Hashes the presented token.
     *
     * <p>The database stores only this hash. A read of {@code identity.user_session} therefore
     * does not yield anything that can be replayed as a session.
     */
    static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required and was not available", e);
        }
    }

    private record SessionRow(
            UUID id,
            UUID userId,
            UUID membershipId,
            Instant issuedAt,
            Instant expiresAt,
            Instant revokedAt,
            boolean mfaSatisfied,
            String userStatus,
            Instant sessionsValidFrom) {
    }

    private record MembershipRow(UUID id, UUID tenantId, String status, String principalType) {
    }
}
