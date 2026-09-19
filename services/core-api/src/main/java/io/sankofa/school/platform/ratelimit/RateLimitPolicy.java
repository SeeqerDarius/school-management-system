package io.sankofa.school.platform.ratelimit;

import java.time.Duration;

/**
 * Named rate-limit policies (§84).
 *
 * <p>Each policy carries two bandwidths rather than one. A single limit forces an unhappy
 * choice: set it high enough for a legitimate burst — a bursar retrying a failed sign-in three
 * times in ten seconds — and it is useless against a sustained attack; set it low enough to stop
 * the attack and it punishes the bursar. Two bandwidths allow a short burst while still capping
 * the hour.
 *
 * <p>These numbers are starting points chosen to be comfortably above observed human behaviour
 * and far below machine behaviour. They are configuration, not truth, and should be revisited
 * against real traffic once there is some.
 */
public enum RateLimitPolicy {

    /**
     * Establishing a session.
     *
     * <p>The attack this blunts is not password guessing — Firebase holds the passwords — but
     * token stuffing and resource exhaustion: every attempt costs a token-verification round
     * trip to Google plus several database queries, so an unthrottled endpoint is a cheap way to
     * make the service expensive.
     */
    SIGN_IN(10, Duration.ofMinutes(1), 60, Duration.ofHours(1)),

    /**
     * Switching the active school.
     *
     * <p>Looser, because the caller is already authenticated. Still bounded: a loop over
     * membership ids is a probe, and the {@code WARN} it logs should not be free to generate.
     */
    SESSION_MEMBERSHIP(30, Duration.ofMinutes(1), 300, Duration.ofHours(1)),

    /**
     * Anything a member of the public can reach without a session — the admissions application
     * form, in particular.
     */
    PUBLIC_ENDPOINT(20, Duration.ofMinutes(1), 200, Duration.ofHours(1));

    private final long burstCapacity;
    private final Duration burstWindow;
    private final long sustainedCapacity;
    private final Duration sustainedWindow;

    RateLimitPolicy(long burstCapacity, Duration burstWindow,
                    long sustainedCapacity, Duration sustainedWindow) {
        this.burstCapacity = burstCapacity;
        this.burstWindow = burstWindow;
        this.sustainedCapacity = sustainedCapacity;
        this.sustainedWindow = sustainedWindow;
    }

    public long burstCapacity() {
        return burstCapacity;
    }

    public Duration burstWindow() {
        return burstWindow;
    }

    public long sustainedCapacity() {
        return sustainedCapacity;
    }

    public Duration sustainedWindow() {
        return sustainedWindow;
    }
}
