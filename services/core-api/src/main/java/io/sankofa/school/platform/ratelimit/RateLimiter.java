package io.sankofa.school.platform.ratelimit;

import java.time.Duration;

/**
 * Decides whether a caller may proceed.
 *
 * <p>An interface because the current implementation is per-instance and in-memory, which is
 * correct for one process and wrong for several: with three instances behind a load balancer,
 * the effective limit is three times what the policy says. Replacing it with a shared store
 * should be a new implementation of this interface, not a rewrite of every call site.
 */
public interface RateLimiter {

    /**
     * Attempts to consume one unit of allowance.
     *
     * @param policy which limit applies
     * @param key    what is being limited — usually a client address, sometimes an account
     * @return whether the caller may proceed, and how long to wait if not
     */
    Decision tryConsume(RateLimitPolicy policy, String key);

    /**
     * @param allowed    whether the request may proceed
     * @param retryAfter how long until allowance returns; {@link Duration#ZERO} when allowed
     * @param remaining  units left in the tighter of the two windows, for the response header
     */
    record Decision(boolean allowed, Duration retryAfter, long remaining) {

        public static Decision allowed(long remaining) {
            return new Decision(true, Duration.ZERO, remaining);
        }

        public static Decision denied(Duration retryAfter) {
            return new Decision(false, retryAfter, 0);
        }

        /** Seconds for the {@code Retry-After} header, which has no sub-second resolution. */
        public long retryAfterSeconds() {
            return Math.max(1, retryAfter.toSeconds());
        }
    }
}
