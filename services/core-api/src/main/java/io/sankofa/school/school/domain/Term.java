package io.sankofa.school.school.domain;

import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * A term (or semester, trimester, quarter) within an academic year.
 *
 * <p>{@code sequence} orders terms within their year and is what reporting joins on;
 * {@code name} is what a school calls it. Keeping the two separate is what lets one tenant use
 * "First Term, Second Term, Third Term" and another "Autumn, Spring, Summer" or
 * "Semester 1, Semester 2" without a single line of code caring which (§136).
 */
public record Term(
        UUID id,
        UUID tenantId,
        UUID academicYearId,
        int sequence,
        String code,
        String name,
        LocalDate startsOn,
        LocalDate endsOn,
        CalendarStatus status,
        boolean current,
        LocalDate reportsDueOn,
        Instant closedAt,
        UUID closedBy,
        long version) {

    private static final int MIN_DAYS = 7;
    private static final int MAX_DAYS = 250;

    /**
     * Validates a proposed term against its academic year.
     *
     * <p>The database already refuses a term outside its year and refuses overlapping terms.
     * This exists so the caller gets a specific, actionable message naming the year's boundaries
     * instead of a constraint-violation error they cannot act on.
     */
    public static void validateWithin(AcademicYear year, LocalDate startsOn, LocalDate endsOn,
                                      LocalDate reportsDueOn) {
        if (startsOn == null || endsOn == null) {
            throw ApiException.validation("A term needs a start and an end date",
                    Map.of("startsOn", "is required", "endsOn", "is required"));
        }
        if (!endsOn.isAfter(startsOn)) {
            throw ApiException.validation("The term must end after it starts",
                    Map.of("endsOn", "must be after the start date"));
        }

        long days = java.time.temporal.ChronoUnit.DAYS.between(startsOn, endsOn);
        if (days < MIN_DAYS) {
            throw ApiException.validation("That term is shorter than a week — check the dates",
                    Map.of("endsOn", "is less than 7 days after the start date"));
        }
        if (days > MAX_DAYS) {
            throw ApiException.validation("That term is longer than eight months — check the dates",
                    Map.of("endsOn", "is more than 250 days after the start date"));
        }

        if (!year.covers(startsOn)) {
            throw ApiException.validation(
                    "The term starts before the academic year does",
                    Map.of("startsOn", "must fall between " + year.startsOn()
                            + " and " + year.endsOn()));
        }
        if (!year.covers(endsOn)) {
            throw ApiException.validation(
                    "The term ends after the academic year does",
                    Map.of("endsOn", "must fall between " + year.startsOn()
                            + " and " + year.endsOn()));
        }

        // A reports-due date before the term ends is legitimate (some schools publish early),
        // but one before the term *starts* is always a mistake.
        if (reportsDueOn != null && reportsDueOn.isBefore(startsOn)) {
            throw ApiException.validation(
                    "Reports cannot be due before the term begins",
                    Map.of("reportsDueOn", "must not be before the term start date"));
        }
    }

    public boolean covers(LocalDate date) {
        return date != null && !date.isBefore(startsOn) && !date.isAfter(endsOn);
    }

    public void requireEditable() {
        if (!status.isEditable()) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "This term is " + status.name().toLowerCase()
                            + " and its dates can no longer be changed");
        }
    }
}
