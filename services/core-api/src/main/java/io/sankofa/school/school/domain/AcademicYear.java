package io.sankofa.school.school.domain;

import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/**
 * An academic year: a named date range that terms sit inside.
 *
 * <p>Carries no assumption about how many terms a year has or what they are called. A Ghanaian
 * three-term year, an English three-term year and a two-semester international calendar are all
 * the same shape here, differing only in data (§14, §136).
 */
public record AcademicYear(
        UUID id,
        UUID tenantId,
        String code,
        String name,
        LocalDate startsOn,
        LocalDate endsOn,
        CalendarStatus status,
        boolean current,
        Instant closedAt,
        UUID closedBy,
        long version) {

    /** Longest plausible academic year, used to catch a mistyped end date. */
    private static final int MAX_DAYS = 550;

    /** Shortest plausible academic year. */
    private static final int MIN_DAYS = 30;

    public AcademicYear {
        if (startsOn != null && endsOn != null && !endsOn.isAfter(startsOn)) {
            throw ApiException.validation("The academic year must end after it starts",
                    java.util.Map.of("endsOn", "must be after the start date"));
        }
    }

    /**
     * Validates a proposed date range before it reaches the database.
     *
     * <p>The database enforces non-overlap and ordering; this catches the errors a person
     * actually makes — a year spanning a decade because a digit was mistyped, or a two-week
     * "year". Both would otherwise be accepted and only surface as nonsense in a report months
     * later.
     */
    public static void validateRange(LocalDate startsOn, LocalDate endsOn) {
        if (startsOn == null || endsOn == null) {
            throw ApiException.validation("An academic year needs a start and an end date",
                    java.util.Map.of("startsOn", "is required", "endsOn", "is required"));
        }
        if (!endsOn.isAfter(startsOn)) {
            throw ApiException.validation("The academic year must end after it starts",
                    java.util.Map.of("endsOn", "must be after the start date"));
        }
        long days = ChronoUnit.DAYS.between(startsOn, endsOn);
        if (days > MAX_DAYS) {
            throw ApiException.validation(
                    "That academic year is longer than 18 months — check the end date",
                    java.util.Map.of("endsOn", "is more than 18 months after the start date"));
        }
        if (days < MIN_DAYS) {
            throw ApiException.validation(
                    "That academic year is shorter than a month — check the dates",
                    java.util.Map.of("endsOn", "is less than 30 days after the start date"));
        }
    }

    /** Whether {@code date} falls within this year, inclusive of both ends. */
    public boolean covers(LocalDate date) {
        return date != null && !date.isBefore(startsOn) && !date.isAfter(endsOn);
    }

    /**
     * Guards an edit against a year that is no longer editable.
     *
     * <p>Once a year is ACTIVE, attendance records, marks and invoices already reference it.
     * Moving its boundaries then would silently re-scope data that has already been reported on.
     */
    public void requireEditable() {
        if (!status.isEditable()) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "This academic year is " + status.name().toLowerCase()
                            + " and its dates can no longer be changed");
        }
    }
}
