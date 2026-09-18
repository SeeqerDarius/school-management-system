package io.sankofa.school.identity.auth;

import io.sankofa.school.platform.id.Ids;
import io.sankofa.school.tenancy.TenantContext;
import io.sankofa.school.tenancy.TenantContextHolder;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

/**
 * Establishes the {@link TenantContext} for the request, or leaves it unset.
 *
 * <p>This filter never rejects anything. It resolves what it can and moves on; authorization is
 * decided later by {@link io.sankofa.school.identity.authz.PermissionAspect} and by Spring
 * Security's own rules. Separating "who is this" from "may they do this" keeps the deny decision
 * in one place instead of two.
 *
 * <p>The active membership arrives in {@code X-Active-Membership}. That header is a
 * <em>request</em>, not an assertion: {@link SessionResolver} checks it against the memberships
 * the authenticated principal actually holds and refuses if it does not match. A forged header
 * therefore yields no session rather than another school's data.
 */
@Component
public class SessionAuthenticationFilter extends OncePerRequestFilter {

    public static final String MEMBERSHIP_HEADER = "X-Active-Membership";
    private static final String BEARER = "Bearer ";

    private final SessionResolver sessionResolver;

    public SessionAuthenticationFilter(SessionResolver sessionResolver) {
        this.sessionResolver = sessionResolver;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith(BEARER)) {
            chain.doFilter(request, response);
            return;
        }

        String token = header.substring(BEARER.length()).trim();
        UUID requestedMembership = Ids.parseOrNull(request.getHeader(MEMBERSHIP_HEADER));

        TenantContext context = sessionResolver.resolve(token, requestedMembership).orElse(null);
        if (context == null) {
            // An invalid or expired token is simply an anonymous request. It becomes a 401 only
            // if the endpoint required authentication, which the security rules decide.
            chain.doFilter(request, response);
            return;
        }

        TenantContextHolder.bind(context);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        context.userId().toString(),
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_USER"))));
        try {
            chain.doFilter(request, response);
        } finally {
            // Both must be cleared: the thread returns to the container's pool, and a leaked
            // context would be inherited by whichever request lands on it next.
            TenantContextHolder.clear();
            SecurityContextHolder.clearContext();
        }
    }
}
