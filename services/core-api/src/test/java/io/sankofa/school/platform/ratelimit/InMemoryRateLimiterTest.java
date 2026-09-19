package io.sankofa.school.platform.ratelimit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the rate limiter.
 *
 * <p>The assertions that matter are the denials. A limiter that always allows passes every
 * happy-path test ever written for it, which is why each case here proves the refusal as well as
 * the permission.
 */
class InMemoryRateLimiterTest {

    private InMemoryRateLimiter limiter;

    @BeforeEach
    void setUp() {
        limiter = new InMemoryRateLimiter();
    }

    @Test
    @DisplayName("a caller may use the full burst allowance and no more")
    void burstIsAllowedThenExhausted() {
        long capacity = RateLimitPolicy.SIGN_IN.burstCapacity();

        for (int attempt = 1; attempt <= capacity; attempt++) {
            RateLimiter.Decision decision = limiter.tryConsume(RateLimitPolicy.SIGN_IN, "1.2.3.4");
            assertThat(decision.allowed())
                    .as("attempt %d of %d should be within the burst allowance", attempt, capacity)
                    .isTrue();
        }

        RateLimiter.Decision exceeded = limiter.tryConsume(RateLimitPolicy.SIGN_IN, "1.2.3.4");
        assertThat(exceeded.allowed())
                .as("the attempt after the allowance is spent must be refused")
                .isFalse();
    }

    @Test
    @DisplayName("a refusal says how long to wait, and never says zero")
    void refusalCarriesRetryAfter() {
        exhaust(RateLimitPolicy.SIGN_IN, "5.6.7.8");

        RateLimiter.Decision denied = limiter.tryConsume(RateLimitPolicy.SIGN_IN, "5.6.7.8");

        assertThat(denied.allowed()).isFalse();
        assertThat(denied.retryAfter()).isPositive();
        // Retry-After has no sub-second resolution, so a sub-second wait must round up to 1
        // rather than down to 0 — which would invite an immediate retry and a tight loop.
        assertThat(denied.retryAfterSeconds()).isGreaterThanOrEqualTo(1);
        assertThat(denied.remaining()).isZero();
    }

    @Test
    @DisplayName("one caller exhausting its allowance does not affect another")
    void keysAreIndependent() {
        exhaust(RateLimitPolicy.SIGN_IN, "10.0.0.1");

        assertThat(limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.1").allowed()).isFalse();
        // The denial-of-service this guards against: one noisy address locking out a school.
        assertThat(limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.2").allowed())
                .as("a different caller must be unaffected")
                .isTrue();
    }

    @Test
    @DisplayName("policies are counted separately for the same caller")
    void policiesAreIndependent() {
        exhaust(RateLimitPolicy.SIGN_IN, "10.0.0.3");

        assertThat(limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.3").allowed()).isFalse();
        // Spending the sign-in allowance must not lock the caller out of switching schools:
        // they are different risks and carry different limits.
        assertThat(limiter.tryConsume(RateLimitPolicy.SESSION_MEMBERSHIP, "10.0.0.3").allowed())
                .isTrue();
    }

    @Test
    @DisplayName("remaining allowance decreases as it is consumed")
    void remainingDecreases() {
        RateLimiter.Decision first = limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.4");
        RateLimiter.Decision second = limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.4");

        assertThat(second.remaining()).isLessThan(first.remaining());
    }

    @Test
    @DisplayName("clearing restores allowance")
    void clearResetsState() {
        exhaust(RateLimitPolicy.SIGN_IN, "10.0.0.5");
        assertThat(limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.5").allowed()).isFalse();

        limiter.clear();

        assertThat(limiter.tryConsume(RateLimitPolicy.SIGN_IN, "10.0.0.5").allowed()).isTrue();
    }

    @Test
    @DisplayName("every policy has a sustained limit above its burst")
    void policiesAreCoherent() {
        // A sustained cap below the burst would make the burst unreachable, quietly turning
        // the two-bandwidth design into a single, much tighter limit.
        for (RateLimitPolicy policy : RateLimitPolicy.values()) {
            assertThat(policy.sustainedCapacity())
                    .as("%s sustained capacity must exceed its burst capacity", policy)
                    .isGreaterThan(policy.burstCapacity());
            assertThat(policy.sustainedWindow())
                    .as("%s sustained window must be longer than its burst window", policy)
                    .isGreaterThan(policy.burstWindow());
        }
    }

    private void exhaust(RateLimitPolicy policy, String key) {
        for (int i = 0; i < policy.burstCapacity(); i++) {
            limiter.tryConsume(policy, key);
        }
    }
}
