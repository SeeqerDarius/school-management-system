package io.sankofa.school.platform.error;

import java.util.Map;

/**
 * A failure that the caller is entitled to understand.
 *
 * <p>Anything thrown as an {@code ApiException} has been deliberately shaped for the client:
 * a stable {@link ErrorCode}, a message safe to display, and optionally per-field detail.
 * Everything else becomes an opaque {@link ErrorCode#INTERNAL_ERROR} with a correlation id,
 * because an unexpected exception's message is written for an engineer reading a log, not for
 * a parent reading a screen.
 */
public class ApiException extends RuntimeException {

    private final ErrorCode code;
    private final Map<String, String> fieldErrors;

    public ApiException(ErrorCode code, String message) {
        this(code, message, Map.of(), null);
    }

    public ApiException(ErrorCode code, String message, Throwable cause) {
        this(code, message, Map.of(), cause);
    }

    public ApiException(ErrorCode code, String message, Map<String, String> fieldErrors,
                        Throwable cause) {
        super(message, cause);
        this.code = code;
        this.fieldErrors = fieldErrors == null ? Map.of() : Map.copyOf(fieldErrors);
    }

    public ErrorCode code() {
        return code;
    }

    public Map<String, String> fieldErrors() {
        return fieldErrors;
    }

    // -------------------------------------------------------------------------------------
    // Factories for the cases that occur constantly
    // -------------------------------------------------------------------------------------

    /**
     * The resource is not visible to this caller.
     *
     * <p>Takes only the resource type, never the id, and never says whether the row exists in
     * another tenant — that distinction is precisely what an attacker is probing for.
     */
    public static ApiException notFound(String resourceType) {
        return new ApiException(ErrorCode.NOT_FOUND, resourceType + " not found");
    }

    public static ApiException forbidden(String requiredPermission) {
        return new ApiException(ErrorCode.FORBIDDEN,
                "You do not have permission to perform this action",
                Map.of("requiredPermission", requiredPermission), null);
    }

    public static ApiException invalidTransition(String entity, String from, String to) {
        return new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                entity + " cannot move from " + from + " to " + to);
    }

    public static ApiException conflict(String message) {
        return new ApiException(ErrorCode.CONFLICT, message);
    }

    public static ApiException validation(String message, Map<String, String> fieldErrors) {
        return new ApiException(ErrorCode.VALIDATION_ERROR, message, fieldErrors, null);
    }

    public static ApiException accountingInvariant(String message) {
        return new ApiException(ErrorCode.ACCOUNTING_INVARIANT, message);
    }
}
