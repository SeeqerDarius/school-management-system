package io.sankofa.school.platform.web;

import io.sankofa.school.platform.ratelimit.RateLimitPolicy;
import io.sankofa.school.testsupport.AbstractApiIT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the sign-in endpoint is actually throttled over HTTP (§84).
 *
 * <p>{@code InMemoryRateLimiterTest} proves the limiter counts correctly. This proves it is
 * <em>wired in</em> — which is the part that silently stops being true when somebody reorders a
 * filter chain, and the part a unit test can never catch.
 */
class RateLimitIT extends AbstractApiIT {

    @Test
    @DisplayName("repeated sign-in attempts are eventually refused with 429")
    void signInIsThrottled() {
        int burst = (int) RateLimitPolicy.SIGN_IN.burstCapacity();

        // Every attempt uses an unverifiable token, so each is refused on its merits with 401.
        // That is the point: the limiter must count *attempts*, not successes, or an attacker
        // simply submits rubbish for free.
        for (int attempt = 1; attempt <= burst; attempt++) {
            ResponseEntity<Map> response = rest.postForEntity(
                    "/api/v1/sessions", json(Map.of("idToken", "invalid-token-" + attempt)),
                    Map.class);

            assertThat(response.getStatusCode())
                    .as("attempt %d should be rejected on the token, not the rate limit", attempt)
                    .isEqualTo(HttpStatus.UNAUTHORIZED);
        }

        ResponseEntity<Map> throttled = rest.postForEntity(
                "/api/v1/sessions", json(Map.of("idToken", "one-too-many")), Map.class);

        assertThat(throttled.getStatusCode())
                .as("the attempt past the burst allowance must be rate limited")
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(throttled.getBody()).containsEntry("code", "RATE_LIMITED");
    }

    @Test
    @DisplayName("a throttled response tells the caller how long to wait")
    void throttledResponseCarriesRetryAfter() {
        exhaustSignInAllowance();

        ResponseEntity<Map> throttled = rest.postForEntity(
                "/api/v1/sessions", json(Map.of("idToken", "blocked")), Map.class);

        assertThat(throttled.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        String retryAfter = throttled.getHeaders().getFirst("Retry-After");
        assertThat(retryAfter)
                .as("Retry-After is what stops a client retrying in a tight loop")
                .isNotNull();
        assertThat(Long.parseLong(retryAfter)).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("the limiter runs before authentication, so a rejected token still costs allowance")
    void limitAppliesBeforeTokenVerification() {
        exhaustSignInAllowance();

        // A *valid* token now, but the allowance is spent. If the limiter ran after
        // verification this would be a 201 — and every refused attempt would have paid for a
        // round trip to Google, which is the cost the limiter exists to avoid.
        identityTokens.accept("valid-token", "firebase-uid-x", "x@example.test", true, false);
        ResponseEntity<Map> response = rest.postForEntity(
                "/api/v1/sessions", json(Map.of("idToken", "valid-token")), Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    @DisplayName("a throttled response leaks nothing about the service")
    void throttledResponseLeaksNothing() {
        exhaustSignInAllowance();

        ResponseEntity<String> throttled = rest.postForEntity(
                "/api/v1/sessions", json(Map.of("idToken", "blocked")), String.class);

        assertThat(throttled.getBody())
                .doesNotContain("java.", "org.springframework", "Exception", "bucket4j");
    }

    @Test
    @DisplayName("reads are not throttled")
    void readsAreNotThrottled() {
        exhaustSignInAllowance();

        // Throttling a GET would make a page refresh feel broken without preventing anything an
        // attacker wants to do. This must be 401 — refused for want of a session, not for want
        // of allowance.
        ResponseEntity<String> read = rest.exchange(
                "/api/v1/sessions/current", HttpMethod.GET, null, String.class);

        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    private void exhaustSignInAllowance() {
        for (int i = 0; i < RateLimitPolicy.SIGN_IN.burstCapacity(); i++) {
            rest.postForEntity("/api/v1/sessions",
                    json(Map.of("idToken", "exhaust-" + i)), Map.class);
        }
    }
}
