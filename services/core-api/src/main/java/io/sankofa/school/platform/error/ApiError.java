package io.sankofa.school.platform.error;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

/**
 * The single error shape this API returns. Never varies by endpoint (§106).
 *
 * <pre>
 * {
 *   "code": "VALIDATION_ERROR",
 *   "message": "Validation failed",
 *   "correlationId": "01J8Z3K9QX4M7BQKPN2VR8TCEH",
 *   "timestamp": "2026-09-18T09:14:22Z",
 *   "fieldErrors": { "admissionNumber": "must not be blank" }
 * }
 * </pre>
 *
 * <p>{@code correlationId} is the only thing that connects what the user saw to what the logs
 * recorded. It appears on the screen precisely so a school can quote it to support without
 * anyone needing a stack trace.
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ApiError(
        String code,
        String message,
        String correlationId,
        Instant timestamp,
        Map<String, String> fieldErrors) {

    public static ApiError of(ErrorCode code, String message, String correlationId) {
        return new ApiError(code.name(), message, correlationId, Instant.now(), Map.of());
    }

    public static ApiError of(ErrorCode code, String message, String correlationId,
                              Map<String, String> fieldErrors) {
        return new ApiError(code.name(), message, correlationId, Instant.now(),
                fieldErrors == null ? Map.of() : Map.copyOf(fieldErrors));
    }
}
