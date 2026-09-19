package io.sankofa.school.platform.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.sankofa.school.platform.context.CorrelationId;
import io.sankofa.school.platform.error.ApiError;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.platform.ratelimit.RateLimitPolicy;
import io.sankofa.school.platform.ratelimit.RateLimiter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Applies rate limits to the endpoints that need them (§84).
 *
 * <p>Runs ahead of authentication, deliberately. A limit applied after token verification would
 * still pay the cost it exists to avoid — a round trip to Google to verify a token an attacker
 * submitted a thousand times.
 *
 * <h2>How the client address is determined, and what that assumes</h2>
 * The key is {@code request.getRemoteAddr()}. With
 * {@code server.forward-headers-strategy=framework}, Spring has already rewritten that from
 * {@code X-Forwarded-For} before this filter sees it.
 *
 * <p>That is correct <em>only if the service is unreachable except through the trusted proxy</em>.
 * If the container's port is exposed directly, an attacker can forge {@code X-Forwarded-For},
 * receive a fresh bucket for every fabricated address, and bypass this filter completely — which
 * is worse than having no limiter, because the dashboard would say we had one. The deployment
 * requirement is recorded in {@code docs/DEPLOYMENT.md}: the API accepts traffic from the load
 * balancer and from nowhere else.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);

    /**
     * Path prefix to policy. Ordered: the first match wins, so more specific paths come first.
     *
     * <p>Endpoints absent from this list are unlimited. That is a deliberate omission for now,
     * not an oversight — §84 also calls for limits on exports, messaging, SMS dispatch, payment
     * initiation and file upload, and those are added as each module lands.
     */
    private static final List<Map.Entry<String, RateLimitPolicy>> RULES = List.of(
            Map.entry("/api/v1/sessions/current/membership", RateLimitPolicy.SESSION_MEMBERSHIP),
            Map.entry("/api/v1/sessions", RateLimitPolicy.SIGN_IN),
            Map.entry("/api/v1/public/", RateLimitPolicy.PUBLIC_ENDPOINT));

    private final RateLimiter rateLimiter;
    private final ObjectMapper objectMapper;

    public RateLimitFilter(RateLimiter rateLimiter, ObjectMapper objectMapper) {
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        RateLimitPolicy policy = policyFor(request);
        if (policy == null) {
            chain.doFilter(request, response);
            return;
        }

        String key = clientKey(request);
        RateLimiter.Decision decision = rateLimiter.tryConsume(policy, key);

        if (decision.allowed()) {
            response.setHeader("X-RateLimit-Remaining", Long.toString(decision.remaining()));
            chain.doFilter(request, response);
            return;
        }

        // A sustained burst of these is one of the more useful security signals this service
        // produces. INFO, not WARN: a single throttled request is routine, and burying the
        // genuine warnings under it would be the greater harm.
        log.info("Rate limit exceeded: policy={} key={} path={} retryAfter={}s",
                policy, key, request.getRequestURI(), decision.retryAfterSeconds());

        writeTooManyRequests(response, decision);
    }

    private static RateLimitPolicy policyFor(HttpServletRequest request) {
        // Only state-changing requests are limited. Throttling a GET on a session would make a
        // page refresh feel broken without preventing anything an attacker wants to do.
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return null;
        }
        String path = request.getRequestURI();
        for (Map.Entry<String, RateLimitPolicy> rule : RULES) {
            if (path.startsWith(rule.getKey())) {
                return rule.getValue();
            }
        }
        return null;
    }

    private static String clientKey(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        // A request with no resolvable address shares one bucket rather than escaping the
        // limiter. Failing closed costs an unusual caller some latency; failing open costs
        // the limiter its purpose.
        return remote == null || remote.isBlank() ? "unknown" : remote;
    }

    private void writeTooManyRequests(HttpServletResponse response, RateLimiter.Decision decision)
            throws IOException {
        response.setStatus(ErrorCode.RATE_LIMITED.httpStatus());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(decision.retryAfterSeconds()));
        response.setHeader("X-RateLimit-Remaining", "0");

        objectMapper.writeValue(response.getOutputStream(), ApiError.of(
                ErrorCode.RATE_LIMITED,
                "Too many attempts. Wait " + decision.retryAfterSeconds()
                        + " seconds and try again.",
                CorrelationId.current()));
    }
}
