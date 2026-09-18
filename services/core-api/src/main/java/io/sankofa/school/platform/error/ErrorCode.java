package io.sankofa.school.platform.error;

/**
 * The stable vocabulary of error codes returned by this API.
 *
 * <p>Clients branch on the code, never on the message. Messages are for humans and may be
 * reworded or translated; codes are a contract and change only with an API version.
 *
 * <p>Nothing here leaks internal structure. "This student does not exist" and "this student
 * belongs to another school" both surface as {@link #NOT_FOUND}, because telling an attacker
 * which of the two is true turns a 404 into an enumeration oracle.
 */
public enum ErrorCode {

    /** Request body or parameters failed validation. Carries {@code fieldErrors}. */
    VALIDATION_ERROR(400),

    /** The request is syntactically wrong — unparseable body, bad type, missing parameter. */
    BAD_REQUEST(400),

    /** No valid session, or the session has expired or been revoked. */
    UNAUTHENTICATED(401),

    /** Authenticated, but the principal lacks the required permission. */
    FORBIDDEN(403),

    /** Multi-factor authentication is required for this account or action and is not satisfied. */
    MFA_REQUIRED(403),

    /**
     * The resource does not exist, or exists in another tenant. Deliberately indistinguishable.
     */
    NOT_FOUND(404),

    /** The operation is not valid for the resource's current state. */
    INVALID_STATE_TRANSITION(409),

    /** A uniqueness rule was violated — duplicate admission number, duplicate receipt, and so on. */
    CONFLICT(409),

    /** The row changed since it was read. The client should refetch and retry. */
    OPTIMISTIC_LOCK(409),

    /** The subscription does not include this module, or a plan limit has been reached. */
    SUBSCRIPTION_LIMIT(402),

    /** Too many requests from this principal, IP or tenant. */
    RATE_LIMITED(429),

    /** The uploaded file failed type, size or content validation. */
    UPLOAD_REJECTED(422),

    /** Debits did not equal credits, or a posted record was mutated. */
    ACCOUNTING_INVARIANT(422),

    /** An upstream provider (payment gateway, SMS, email) failed or returned an error. */
    PROVIDER_ERROR(502),

    /** Anything unhandled. The correlation id is the only detail the client receives. */
    INTERNAL_ERROR(500);

    private final int httpStatus;

    ErrorCode(int httpStatus) {
        this.httpStatus = httpStatus;
    }

    public int httpStatus() {
        return httpStatus;
    }
}
