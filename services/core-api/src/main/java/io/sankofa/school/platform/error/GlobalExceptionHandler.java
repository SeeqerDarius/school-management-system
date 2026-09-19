package io.sankofa.school.platform.error;

import io.sankofa.school.platform.money.CurrencyMismatchException;
import io.sankofa.school.platform.context.CorrelationId;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
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
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

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
        String correlationId = CorrelationId.current();
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
        log.debug("[{}] Malformed request", CorrelationId.current(), e);
        return respond(ErrorCode.BAD_REQUEST, "The request could not be read", Map.of());
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiError> handleAuthentication(AuthenticationException e) {
        return respond(ErrorCode.UNAUTHENTICATED, "Authentication is required", Map.of());
    }

    /**
     * A URL that does not exist.
     *
     * <p>Without this, a mistyped path fell through to the catch-all and returned 500 with an
     * ERROR log line — which is wrong twice over: it tells the caller the server broke when the
     * caller simply asked for something that is not there, and it fills the error log with
     * noise that would bury a real failure. Every scanner on the internet probes for
     * {@code /wp-login.php}; none of those should look like an incident.
     */
    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<ApiError> handleNoResource(Exception e) {
        log.debug("[{}] No handler for request", CorrelationId.current());
        return respond(ErrorCode.NOT_FOUND, "Not found", Map.of());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException e) {
        // Logged at INFO: a burst of these is a meaningful security signal (§179).
        log.info("[{}] Access denied: {}", CorrelationId.current(), e.getMessage());
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
        log.info("[{}] Uniqueness violation", CorrelationId.current(), e);
        return respond(ErrorCode.CONFLICT, "A record with these details already exists", Map.of());
    }

    /**
     * A constraint the database enforces that the service layer could not.
     *
     * <p>The important case is {@code 23P01}, an exclusion-constraint violation — two academic
     * years overlapping, two terms overlapping, a double-booked room. Those are rules that
     * <em>must</em> live in the database, because two administrators submitting simultaneously
     * both pass any read-then-check the application could perform.
     *
     * <p>They are user errors, not server errors, so they return 409 rather than falling through
     * to the catch-all and reporting a 500 for something the user can simply fix.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException e) {
        String sqlState = sqlStateOf(e);
        String correlationId = CorrelationId.current();

        if ("23P01".equals(sqlState)) {
            log.info("[{}] Exclusion constraint violation", correlationId, e);
            return respond(ErrorCode.CONFLICT,
                    "That date range overlaps one that already exists", Map.of());
        }
        if ("23505".equals(sqlState)) {
            log.info("[{}] Uniqueness violation", correlationId, e);
            return respond(ErrorCode.CONFLICT,
                    "A record with these details already exists", Map.of());
        }
        if ("23514".equals(sqlState) || "23503".equals(sqlState)) {
            log.info("[{}] Constraint violation (SQLState {})", correlationId, sqlState, e);
            return respond(ErrorCode.CONFLICT,
                    "That change conflicts with a rule this record must satisfy", Map.of());
        }

        // Anything else is genuinely unexpected and deserves the loud treatment.
        log.error("[{}] Unclassified data integrity violation (SQLState {})",
                correlationId, sqlState, e);
        return respond(ErrorCode.INTERNAL_ERROR,
                "Something went wrong. Quote reference " + correlationId + " to support.",
                Map.of());
    }

    /** Walks the cause chain for the driver's SQLState, which Spring's wrapper hides. */
    private static String sqlStateOf(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql) {
                return sql.getSQLState();
            }
            if (cause.getCause() == cause) {
                break;
            }
        }
        return null;
    }

    @ExceptionHandler(CurrencyMismatchException.class)
    public ResponseEntity<ApiError> handleCurrencyMismatch(CurrencyMismatchException e) {
        log.error("[{}] Currency mismatch: {} vs {}",
                CorrelationId.current(), e.left(), e.right(), e);
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
        String correlationId = CorrelationId.current();
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
        String correlationId = CorrelationId.current();
        log.error("[{}] Unhandled exception", correlationId, e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiError.of(ErrorCode.INTERNAL_ERROR,
                        "Something went wrong. Quote reference " + correlationId + " to support.",
                        correlationId));
    }

    private static ResponseEntity<ApiError> respond(ErrorCode code, String message,
                                                    Map<String, String> fields) {
        String correlationId = CorrelationId.current();
        return ResponseEntity.status(code.httpStatus())
                .body(ApiError.of(code, message, correlationId, fields));
    }
}
