package io.sankofa.school.school.domain;

import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * The academic calendar state machine.
 *
 * <p>AGENTS.md §7 requires every legal transition <b>and</b> at least one illegal one to be
 * covered. Both directions are tested exhaustively here rather than by sampling, because the
 * table is small and the cost of a wrong answer — a closed year quietly reopening and changing
 * what an already-issued report card means — is not.
 */
class CalendarStatusTest {

    @ParameterizedTest(name = "{0} -> {1} is allowed")
    @CsvSource({
            "PLANNED, ACTIVE",
            "PLANNED, CLOSED",
            "ACTIVE,  CLOSED",
    })
    @DisplayName("every legal transition is permitted")
    void legalTransitions(CalendarStatus from, CalendarStatus to) {
        assertThat(from.canTransitionTo(to)).isTrue();
        assertThatCode(() -> from.requireTransitionTo(to, "Academic year"))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest(name = "{0} -> {1} is refused")
    @CsvSource({
            // Reopening is the one everybody asks for, and the one that must not exist:
            // it would retroactively change what an issued report card means.
            "CLOSED,  ACTIVE",
            "CLOSED,  PLANNED",
            "ACTIVE,  PLANNED",
    })
    @DisplayName("every illegal transition is refused")
    void illegalTransitions(CalendarStatus from, CalendarStatus to) {
        assertThat(from.canTransitionTo(to)).isFalse();
        assertThatThrownBy(() -> from.requireTransitionTo(to, "Academic year"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).code())
                        .isEqualTo(ErrorCode.INVALID_STATE_TRANSITION))
                .hasMessageContaining(from.name())
                .hasMessageContaining(to.name());
    }

    @ParameterizedTest
    @EnumSource(CalendarStatus.class)
    @DisplayName("a status never transitions to itself")
    void noSelfTransition(CalendarStatus status) {
        assertThat(status.canTransitionTo(status)).isFalse();
        assertThatThrownBy(() -> status.requireTransitionTo(status, "Term"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("CLOSED is terminal")
    void closedIsTerminal() {
        assertThat(CalendarStatus.CLOSED.allowedTransitions()).isEmpty();
        assertThat(CalendarStatus.CLOSED.isClosed()).isTrue();
    }

    @Test
    @DisplayName("only a planned period is freely editable")
    void onlyPlannedIsEditable() {
        assertThat(CalendarStatus.PLANNED.isEditable()).isTrue();
        assertThat(CalendarStatus.ACTIVE.isEditable()).isFalse();
        assertThat(CalendarStatus.CLOSED.isEditable()).isFalse();
    }

    @Test
    @DisplayName("an unrecognised status from the database fails loudly")
    void unknownStatusFailsLoudly() {
        // If a migration adds a status the code does not know, returning null or a default
        // would let it flow silently into a state machine that cannot reason about it.
        assertThatThrownBy(() -> CalendarStatus.of("ARCHIVED"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("ARCHIVED");
    }

    // ===================================================================================

    @Test
    @DisplayName("an academic year must end after it starts")
    void yearMustEndAfterItStarts() {
        assertThatThrownBy(() -> AcademicYear.validateRange(
                LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 1)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("must end after it starts");
    }

    @Test
    @DisplayName("a mistyped year that spans a decade is rejected")
    void implausiblyLongYearRejected() {
        // The realistic error: 2036 typed for 2026. The database would accept it happily.
        assertThatThrownBy(() -> AcademicYear.validateRange(
                LocalDate.of(2026, 9, 1), LocalDate.of(2036, 7, 31)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("longer than 18 months");
    }

    @Test
    @DisplayName("an implausibly short year is rejected")
    void implausiblyShortYearRejected() {
        assertThatThrownBy(() -> AcademicYear.validateRange(
                LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 15)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("shorter than a month");
    }

    @Test
    @DisplayName("a Ghanaian three-term year and an international two-semester year both validate")
    void realCalendarShapesAreAccepted() {
        // Sept-to-July, three terms.
        assertThatCode(() -> AcademicYear.validateRange(
                LocalDate.of(2026, 9, 8), LocalDate.of(2027, 7, 30)))
                .doesNotThrowAnyException();

        // August-to-June, two semesters.
        assertThatCode(() -> AcademicYear.validateRange(
                LocalDate.of(2026, 8, 17), LocalDate.of(2027, 6, 11)))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a term outside its academic year is rejected with a message naming the bounds")
    void termOutsideYearRejected() {
        AcademicYear year = year(LocalDate.of(2026, 9, 8), LocalDate.of(2027, 7, 30));

        assertThatThrownBy(() -> Term.validateWithin(year,
                LocalDate.of(2026, 8, 1), LocalDate.of(2026, 12, 18), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("starts before the academic year");

        assertThatThrownBy(() -> Term.validateWithin(year,
                LocalDate.of(2027, 5, 1), LocalDate.of(2027, 8, 30), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("ends after the academic year");
    }

    @Test
    @DisplayName("a term flush against the year boundaries is accepted")
    void termOnYearBoundaryAccepted() {
        AcademicYear year = year(LocalDate.of(2026, 9, 8), LocalDate.of(2027, 7, 30));
        assertThatCode(() -> Term.validateWithin(year,
                LocalDate.of(2026, 9, 8), LocalDate.of(2026, 12, 18), null))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("reports cannot be due before the term begins")
    void reportsDueBeforeTermStartRejected() {
        AcademicYear year = year(LocalDate.of(2026, 9, 8), LocalDate.of(2027, 7, 30));
        assertThatThrownBy(() -> Term.validateWithin(year,
                LocalDate.of(2026, 9, 8), LocalDate.of(2026, 12, 18),
                LocalDate.of(2026, 9, 1)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("before the term begins");
    }

    private static AcademicYear year(LocalDate from, LocalDate to) {
        return new AcademicYear(java.util.UUID.randomUUID(), java.util.UUID.randomUUID(),
                "2026/2027", "2026/2027", from, to, CalendarStatus.PLANNED, false, null, null, 0L);
    }
}
