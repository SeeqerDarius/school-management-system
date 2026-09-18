package io.sankofa.school.school.domain;

import io.sankofa.school.platform.error.ApiException;

import java.util.EnumSet;
import java.util.Set;

/**
 * Lifecycle of an academic year or a term.
 *
 * <p>An explicit state machine rather than a scattering of booleans (§186). {@code isActive},
 * {@code isClosed} and {@code isPlanned} as separate flags admit combinations that mean nothing —
 * closed and active at once — and every read site then has to decide what such a row means.
 *
 * <p>Transitions are enumerated here rather than checked at each call site, so "can a closed year
 * be reopened" has exactly one answer in the codebase (§187).
 */
public enum CalendarStatus {

    /** Created, dates set, not yet in use. Freely editable. */
    PLANNED,

    /** In use. Attendance, marks and invoices reference it. Dates are no longer freely editable. */
    ACTIVE,

    /**
     * Finished. Historical records remain readable forever; new work cannot be booked against it.
     *
     * <p>Terminal by design. Reopening a closed year would silently change what a previously
     * issued report card means, so correction is by amendment within the year's own records, not
     * by reopening it (§140). A genuine administrative error is resolved by the authorised
     * reopen procedure in the accounting module, which is a separate, audited action.
     */
    CLOSED;

    private static final Set<CalendarStatus> FROM_PLANNED = EnumSet.of(ACTIVE, CLOSED);
    private static final Set<CalendarStatus> FROM_ACTIVE = EnumSet.of(CLOSED);
    private static final Set<CalendarStatus> FROM_CLOSED = EnumSet.noneOf(CalendarStatus.class);

    public Set<CalendarStatus> allowedTransitions() {
        return switch (this) {
            case PLANNED -> FROM_PLANNED;
            case ACTIVE -> FROM_ACTIVE;
            case CLOSED -> FROM_CLOSED;
        };
    }

    public boolean canTransitionTo(CalendarStatus target) {
        return allowedTransitions().contains(target);
    }

    /**
     * Asserts the transition is legal, or fails with a message naming both states.
     *
     * @param entity the noun to use in the error, e.g. {@code "Academic year"}
     */
    public void requireTransitionTo(CalendarStatus target, String entity) {
        if (this == target) {
            throw ApiException.invalidTransition(entity, name(), target.name());
        }
        if (!canTransitionTo(target)) {
            throw ApiException.invalidTransition(entity, name(), target.name());
        }
    }

    /** Whether dates and naming may still be changed freely. */
    public boolean isEditable() {
        return this == PLANNED;
    }

    public boolean isClosed() {
        return this == CLOSED;
    }

    public static CalendarStatus of(String value) {
        try {
            return valueOf(value);
        } catch (IllegalArgumentException | NullPointerException e) {
            // A status the database holds but this enum does not know means a migration added a
            // value without updating the code. Failing loudly is correct.
            throw new IllegalStateException("Unknown calendar status in database: " + value, e);
        }
    }
}
