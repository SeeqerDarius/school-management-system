package io.sankofa.school.platform.ratelimit;

import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Cache;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * A per-instance, in-memory rate limiter.
 *
 * <h2>Its one significant limitation, stated plainly</h2>
 * Each process keeps its own buckets. Behind a load balancer with three instances, the effective
 * limit is three times the policy — a caller spread across instances gets three times the
 * allowance. That is a real weakening, not a rounding error.
 *
 * <p>It is nonetheless the right first implementation: it is correct for a single instance, it
 * adds no infrastructure, and it turns an endpoint with <em>no</em> limit into one with a limit.
 * Moving to a shared store (Redis, or PostgreSQL via bucket4j's JDBC backend) is a change of
 * implementation behind {@link RateLimiter}, and is required before scaling past one instance.
 * Recorded as a gap in {@code IMPLEMENTATION_STATUS.md}.
 *
 * <h2>Why buckets expire</h2>
 * Entries are evicted after an hour of disuse. Without that, the map is an unbounded cache keyed
 * on attacker-controlled input — which converts a rate limiter into a memory-exhaustion
 * vulnerability, the exact failure mode it was added to prevent.
 */
@Component
public class InMemoryRateLimiter implements RateLimiter {

    /**
     * Bounded on both size and age. 100k entries is far more than a real deployment needs and
     * far less than an attacker would like.
     */
    private final Cache<String, Bucket> buckets = Caffeine.newBuilder()
            .maximumSize(100_000)
            .expireAfterAccess(Duration.ofHours(1))
            .build();

    @Override
    public Decision tryConsume(RateLimitPolicy policy, String key) {
        Bucket bucket = buckets.get(policy.name() + '|' + key, ignored -> newBucket(policy));

        ConsumptionProbe probe = bucket.tryConsumeAndReturnRemaining(1);
        if (probe.isConsumed()) {
            return Decision.allowed(probe.getRemainingTokens());
        }
        return Decision.denied(Duration.ofNanos(probe.getNanosToWaitForRefill()));
    }

    /**
     * Discards all allowance state.
     *
     * <p>Exists for tests, and is deliberately <em>not</em> on {@link RateLimiter}: production
     * code has no business clearing a limit, and putting it on the interface would invite
     * exactly that. Integration tests sign in far more often than any human would, so without
     * this they would trip the limit and fail for a reason unrelated to what they assert —
     * and the temptation would then be to loosen the policy, which is the wrong fix.
     * {@code RateLimitIT} exercises the real limits in isolation.
     */
    public void clear() {
        buckets.invalidateAll();
    }

    private static Bucket newBucket(RateLimitPolicy policy) {
        // Greedy refill drips allowance back continuously rather than restoring the whole
        // capacity on a window boundary. Interval refill would let an attacker take the full
        // capacity, wait for the boundary, and immediately take it again — twice the intended
        // rate across the boundary.
        Bandwidth burst = Bandwidth.builder()
                .capacity(policy.burstCapacity())
                .refillGreedy(policy.burstCapacity(), policy.burstWindow())
                .build();

        Bandwidth sustained = Bandwidth.builder()
                .capacity(policy.sustainedCapacity())
                .refillGreedy(policy.sustainedCapacity(), policy.sustainedWindow())
                .build();

        // Both must permit the request. The burst limit catches a rapid flurry; the sustained
        // limit catches a patient attacker pacing themselves just under it.
        return Bucket.builder()
                .addLimit(burst)
                .addLimit(sustained)
                .build();
    }
}
