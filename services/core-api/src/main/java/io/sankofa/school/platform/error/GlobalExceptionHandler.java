package io.sankofa.school.platform.error;

import io.sankofa.school.platform.money.CurrencyMismatchException;
import io.sankofa.school.platform.web.CorrelationIdFilter;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Turns every exception into the canonical {@link ApiError}.
 *
 * <p>Two rules govern this class:
 *
 * <ol>
 *   <li><b>No stack trace, SQL fragment, table name or exception class name ever reaches the
 *       client.</b> An unexpected failure returns a correlation id and nothing else; the detail
 *       goes to the log, where it belongs.</li>
 *   <li><b>Nothing is swallowed.</b> Invariant I-8. Every branch here either returns a meaningful
 *       error to the caller or logs at ERROR with the correlation id. There is no path that
 *       quietly returns success.</li>
 * </ol>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApi(ApiException e) {
        String correlationId = CorrelationIdFilter.current();
        // Client errors are expected traffic; only server-side codes deserve an ERROR line.
        if (e.code().httpStatus() >= 500) {
            log.error("[{}] {}", correlationId, e.getMessage(), e);
        } else {
            log.debug("[{}] {}: {}", correlationId, e.code(), e.getMessage());
        }
        return ResponseEntity.status(e.code().httpStatus())
                .body(ApiError.of(e.code(), e.getMessage(), correlationId, e.fieldErrors()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleBeanValidation(MethodArgumentNotValidException e) {
        Map<String, String> fields = new LinkedHashMap<>();
        e.getBindingResult().getFieldErrors().forEach(fe ->
                fields.putIfAbsent(fe.getField(),
                        fe.getDefaultMessage() == null ? "is invalid" : fe.getDefaultMessage()));
        e.getBindingResult().getGlobalErrors().forEach(ge ->
                fields.putIfAbsent(ge.getObjectName(),
                        ge.getDefaultMessage() == null ? "is invalid" : ge.getDefaultMessage()));
        return respond(ErrorCode.VALIDATION_ERROR, "Validation failed", fields);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiError> handleConstraintViolation(ConstraintViolationException e) {
        Map<String, String> fields = new LinkedHashMap<>();
        for (ConstraintViolation<?> v : e.getConstraintViolations()) {
            fields.putIfAbsent(v.getPropertyPath().toString(), v.getMessage());
        }
        return respond(ErrorCode.VALIDATION_ERROR, "Validation failed", fields);
    }

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ApiError> handleMalformed(Exception e) {
        // The exception message can quote the request body, which may contain personal data or
        // a password field. It is logged at DEBUG only and never returned.
        log.debug("[{}] Malformed request", CorrelationIdFilter.current(), e);
        return respond(ErrorCode.BAD_REQUEST, "The request could not be read", Map.of());
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiError> handleAuthentication(AuthenticationException e) {
        return respond(ErrorCode.UNAUTHENTICATED, "Authentication is required", Map.of());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException e) {
        // Logged at INFO: a burst of these is a meaningful security signal (§179).
        log.info("[{}] Access denied: {}", CorrelationIdFilter.current(), e.getMessage());
        return respond(ErrorCode.FORBIDDEN,
                "You do not have permission to perform this action", Map.of());
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimisticLock(OptimisticLockingFailureException e) {
        return respond(ErrorCode.OPTIMISTIC_LOCK,
                "This record was changed by someone else. Reload and try again.", Map.of());
    }

    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<ApiError> handleDuplicate(DuplicateKeyException e) {
        // The driver message names the index, which discloses schema. Log it, do not return it.
        log.info("[{}] Uniqueness violation", CorrelationIdFilter.current(), e);
        return respond(ErrorCode.CONFLICT, "A record with these details already exists", Map.of());
    }

    @ExceptionHandler(CurrencyMismatchException.class)
    public ResponseEntity<ApiError> handleCurrencyMismatch(CurrencyMismatchException e) {
        log.error("[{}] Currency mismatch: {} vs {}",
                CorrelationIdFilter.current(), e.left(), e.right(), e);
        return respond(ErrorCode.ACCOUNTING_INVARIANT,
                "Amounts in different currencies cannot be combined", Map.of());
    }

    /**
     * A database error that reached the web layer.
     *
     * <p>PostgreSQL error 42501 is what {@code platform.current_tenant_id()} raises when no tenant
     * is bound. That is not a client error — it means a query escaped tenant scoping, which is a
     * defect in our code and is logged as such.
     */
    @ExceptionHandler(SQLException.class)
    public ResponseEntity<ApiError> handleSql(SQLException e) {
        String correlationId = CorrelationIdFilter.current();
        if ("42501".equals(e.getSQLState())) {
            log.error("[{}] TENANT SCOPING FAILURE — a query ran without a bound tenant. "
                    + "This is a defect, not a client error.", correlationId, e);
        } else {
            log.error("[{}] Database error (SQLState {})", correlationId, e.getSQLState(), e);
        }
        return respond(ErrorCode.INTERNAL_ERROR,
                "Something went wrong. Quote reference " + correlationId + " to support.",
                Map.of());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception e) {
        String correlationId = CorrelationIdFilter.current();
        log.error("[{}] Unhandled exception", correlationId, e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiError.of(ErrorCode.INTERNAL_ERROR,
                        "Something went wrong. Quote reference " + correlationId + " to support.",
                        correlationId));
    }

    private static ResponseEntity<ApiError> respond(ErrorCode code, String message,
                                                    Map<String, String> fields) {
        String correlationId = CorrelationIdFilter.current();
        return ResponseEntity.status(code.httpStatus())
                .body(ApiError.of(code, message, correlationId, fields));
    }
}
