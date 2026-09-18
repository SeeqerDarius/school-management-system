package io.sankofa.school.identity.api;

import io.sankofa.school.identity.application.SessionService;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.tenancy.TenantContext;
import io.sankofa.school.tenancy.TenantContextHolder;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Session lifecycle.
 *
 * <p>The web tier calls these server-to-server and keeps the returned token in an httpOnly,
 * Secure, SameSite cookie. The token is never handed to browser JavaScript, which is what keeps
 * an XSS bug in one dashboard from becoming account takeover across a school.
 *
 * <p>Note what {@code POST /sessions} deliberately does <em>not</em> do: it does not pick a
 * school. It returns the memberships the user holds and stops. Binding one is a separate,
 * separately-authorized call, so "which tenant am I acting as" is always an explicit decision
 * that the server checked, never an inference from a subdomain.
 */
@RestController
@RequestMapping("/api/v1/sessions")
@Tag(name = "Sessions", description = "Sign in, choose a school, sign out")
public class SessionController {

    private final SessionService sessionService;

    public SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @PostMapping
    @Operation(summary = "Exchange a verified identity token for a session")
    public ResponseEntity<SignInResponse> signIn(@Valid @RequestBody SignInRequest request,
                                                 HttpServletRequest http) {
        SessionService.SignInResult result = sessionService.signIn(
                request.idToken(), clientIp(http), http.getHeader("User-Agent"));

        List<MembershipResponse> memberships = result.memberships().stream()
                .map(m -> new MembershipResponse(
                        m.membershipId(), m.tenantSlug(), m.tenantName(), m.principalType()))
                .toList();

        return ResponseEntity.status(HttpStatus.CREATED).body(new SignInResponse(
                result.sessionToken(), result.expiresAt(), memberships));
    }

    @PostMapping("/current/membership")
    @Operation(summary = "Bind the current session to one school")
    public ResponseEntity<Void> selectMembership(
            @Valid @RequestBody SelectMembershipRequest request,
            HttpServletRequest http) {
        TenantContext context = requireContext();
        sessionService.selectMembership(
                bearerToken(http), context.userId(), request.membershipId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/current")
    @Operation(summary = "Describe the current session")
    public CurrentSessionResponse current() {
        TenantContext context = requireContext();
        // The permission list is what the UI uses to decide what to render. It is a
        // convenience, not a control: the server re-checks every action regardless of what
        // the client chose to show (§98).
        return new CurrentSessionResponse(
                context.userId(),
                context.tenantId(),
                context.membershipId(),
                new TreeSet<>(context.permissions()),
                context.isSupportSession());
    }

    @DeleteMapping("/current")
    @Operation(summary = "Sign out")
    public ResponseEntity<Void> signOut(HttpServletRequest http) {
        sessionService.revoke(bearerToken(http), "SIGNED_OUT");
        return ResponseEntity.noContent().build();
    }

    // ===================================================================================

    private static TenantContext requireContext() {
        return TenantContextHolder.current()
                .orElseThrow(() -> new ApiException(
                        ErrorCode.UNAUTHENTICATED, "Authentication is required"));
    }

    private static String bearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Authentication is required");
        }
        return header.substring("Bearer ".length()).trim();
    }

    /**
     * The client address.
     *
     * <p>Read from the servlet request rather than from {@code X-Forwarded-For} directly:
     * Spring's {@code forward-headers-strategy} handles the proxy hop using configuration we
     * control, whereas trusting the raw header would let any caller forge the IP that lands in
     * the security event log.
     */
    private static String clientIp(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        return remote == null || remote.isBlank() ? null : remote;
    }

    // ===================================================================================

    public record SignInRequest(
            @NotBlank(message = "is required") String idToken) {
    }

    public record SignInResponse(
            String sessionToken,
            Instant expiresAt,
            List<MembershipResponse> memberships) {
    }

    public record MembershipResponse(
            UUID membershipId,
            String schoolSlug,
            String schoolName,
            String principalType) {
    }

    public record SelectMembershipRequest(
            @NotNull(message = "is required") UUID membershipId) {
    }

    public record CurrentSessionResponse(
            UUID userId,
            UUID tenantId,
            UUID membershipId,
            Set<String> permissions,
            boolean supportSession) {
    }
}
