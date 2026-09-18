package io.sankofa.school.platform.config;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Typed configuration for the platform.
 *
 * <p>Bound and validated at startup, so a missing or nonsensical value fails the boot rather
 * than surfacing at 2am as a session that never expires.
 */
@ConfigurationProperties(prefix = "sankofa")
@Validated
public record SankofaProperties(
        @NotNull Firebase firebase,
        @NotNull Session session,
        @NotNull Outbox outbox) {

    /**
     * @param projectId       the Firebase project. Each environment gets its own (§182)
     * @param credentialsPath a service-account file OUTSIDE the repository, or empty to use
     *                        Application Default Credentials, which is preferred in any
     *                        managed runtime because there is no file to leak
     * @param storageBucket   private bucket; objects are served only through signed URLs (§68)
     */
    public record Firebase(String projectId, String credentialsPath, String storageBucket) {
        public boolean isConfigured() {
            return projectId != null && !projectId.isBlank();
        }
    }

    /**
     * @param ttl           ordinary session lifetime
     * @param privilegedTtl lifetime for a membership holding sensitive permissions — bursar,
     *                      accountant, payroll officer, school or platform admin. Shorter on
     *                      purpose: the blast radius of a stolen session scales with how long
     *                      it stays valid and with what it can reach
     */
    public record Session(@NotNull Duration ttl, @NotNull Duration privilegedTtl) {
    }

    public record Outbox(
            @NotNull Duration pollInterval,
            int batchSize,
            int maxAttempts) {
    }
}
