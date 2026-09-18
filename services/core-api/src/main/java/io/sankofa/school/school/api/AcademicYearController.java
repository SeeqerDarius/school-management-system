package io.sankofa.school.school.api;

import io.sankofa.school.school.application.AcademicCalendarService;
import io.sankofa.school.school.domain.AcademicYear;
import io.sankofa.school.school.domain.Term;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Academic years, and the terms belonging to one.
 *
 * <p>State changes are POSTs to named sub-resources — {@code /activate}, {@code /close},
 * {@code /make-current} — rather than a PATCH that sets a status field. The distinction matters:
 * "close this year" is an operation with preconditions, a required reason and an audit entry,
 * not a field assignment, and modelling it as one keeps the client from believing it can put the
 * system into any state it likes.
 *
 * <p>No authorization is decided here. Every method delegates to the service, where
 * {@code @RequiresPermission} runs before the transaction opens.
 */
@RestController
@RequestMapping("/api/v1/academic-years")
@Tag(name = "Academic calendar", description = "Academic years and terms")
public class AcademicYearController {

    private final AcademicCalendarService calendar;

    public AcademicYearController(AcademicCalendarService calendar) {
        this.calendar = calendar;
    }

    // ===================================================================================
    // Years
    // ===================================================================================

    @GetMapping
    @Operation(summary = "List academic years, newest first")
    public List<AcademicYearResponse> list() {
        return calendar.listYears().stream().map(AcademicYearResponse::from).toList();
    }

    @GetMapping("/current")
    @Operation(summary = "The academic year new work defaults to")
    public AcademicYearResponse current() {
        return AcademicYearResponse.from(calendar.currentYear());
    }

    @GetMapping("/{id}")
    @Operation(summary = "One academic year")
    public AcademicYearResponse get(@PathVariable UUID id) {
        return AcademicYearResponse.from(calendar.getYear(id));
    }

    @PostMapping
    @Operation(summary = "Create an academic year")
    public ResponseEntity<AcademicYearResponse> create(
            @Valid @RequestBody CreateAcademicYearRequest request) {
        AcademicYear created = calendar.createYear(
                request.code(), request.name(), request.startsOn(), request.endsOn());
        return ResponseEntity.status(HttpStatus.CREATED).body(AcademicYearResponse.from(created));
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a planned academic year")
    public AcademicYearResponse update(@PathVariable UUID id,
                                       @Valid @RequestBody UpdateAcademicYearRequest request) {
        return AcademicYearResponse.from(calendar.updateYear(id, request.code(), request.name(),
                request.startsOn(), request.endsOn(), request.version()));
    }

    @PostMapping("/{id}/activate")
    @Operation(summary = "Put an academic year into use")
    public AcademicYearResponse activate(@PathVariable UUID id) {
        return AcademicYearResponse.from(calendar.activateYear(id));
    }

    @PostMapping("/{id}/close")
    @Operation(summary = "Close an academic year permanently")
    public AcademicYearResponse close(@PathVariable UUID id,
                                      @Valid @RequestBody ReasonRequest request) {
        return AcademicYearResponse.from(calendar.closeYear(id, request.reason()));
    }

    @PostMapping("/{id}/make-current")
    @Operation(summary = "Make this the academic year new work defaults to")
    public AcademicYearResponse makeCurrent(@PathVariable UUID id) {
        return AcademicYearResponse.from(calendar.makeYearCurrent(id));
    }

    // ===================================================================================
    // Terms within a year
    // ===================================================================================

    @GetMapping("/{id}/terms")
    @Operation(summary = "Terms in this academic year, in sequence")
    public List<TermResponse> terms(@PathVariable UUID id) {
        return calendar.listTerms(id).stream().map(TermResponse::from).toList();
    }

    @PostMapping("/{id}/terms")
    @Operation(summary = "Add a term to this academic year")
    public ResponseEntity<TermResponse> createTerm(@PathVariable UUID id,
                                                   @Valid @RequestBody CreateTermRequest request) {
        Term created = calendar.createTerm(id, request.code(), request.name(),
                request.startsOn(), request.endsOn(), request.reportsDueOn(), request.sequence());
        return ResponseEntity.status(HttpStatus.CREATED).body(TermResponse.from(created));
    }

    // ===================================================================================
    // Requests
    // ===================================================================================

    public record CreateAcademicYearRequest(
            @NotBlank(message = "is required")
            @Size(max = 32, message = "must be 32 characters or fewer")
            String code,

            @NotBlank(message = "is required")
            @Size(max = 120, message = "must be 120 characters or fewer")
            String name,

            @NotNull(message = "is required") LocalDate startsOn,
            @NotNull(message = "is required") LocalDate endsOn) {
    }

    public record UpdateAcademicYearRequest(
            @NotBlank(message = "is required") @Size(max = 32) String code,
            @NotBlank(message = "is required") @Size(max = 120) String name,
            @NotNull(message = "is required") LocalDate startsOn,
            @NotNull(message = "is required") LocalDate endsOn,
            // Echoed back from the read. If someone else saved in between, the update is
            // refused rather than silently overwriting a change this caller never saw.
            long version) {
    }

    public record CreateTermRequest(
            @NotBlank(message = "is required") @Size(max = 32) String code,
            @NotBlank(message = "is required") @Size(max = 120) String name,
            @NotNull(message = "is required") LocalDate startsOn,
            @NotNull(message = "is required") LocalDate endsOn,
            LocalDate reportsDueOn,
            /** Omit to append after the last existing term. */
            Integer sequence) {
    }

    public record ReasonRequest(
            @NotBlank(message = "is required")
            @Size(min = 3, max = 500, message = "must say something meaningful")
            String reason) {
    }

    // ===================================================================================
    // Responses
    // ===================================================================================

    public record AcademicYearResponse(
            UUID id,
            String code,
            String name,
            LocalDate startsOn,
            LocalDate endsOn,
            String status,
            boolean current,
            /** What the client may offer next, so the UI need not reimplement the state machine. */
            List<String> allowedTransitions,
            boolean editable,
            long version) {

        static AcademicYearResponse from(AcademicYear year) {
            return new AcademicYearResponse(
                    year.id(), year.code(), year.name(), year.startsOn(), year.endsOn(),
                    year.status().name(), year.current(),
                    year.status().allowedTransitions().stream().map(Enum::name).sorted().toList(),
                    year.status().isEditable(), year.version());
        }
    }

    public record TermResponse(
            UUID id,
            UUID academicYearId,
            int sequence,
            String code,
            String name,
            LocalDate startsOn,
            LocalDate endsOn,
            LocalDate reportsDueOn,
            String status,
            boolean current,
            List<String> allowedTransitions,
            boolean editable,
            long version) {

        static TermResponse from(Term term) {
            return new TermResponse(
                    term.id(), term.academicYearId(), term.sequence(), term.code(), term.name(),
                    term.startsOn(), term.endsOn(), term.reportsDueOn(),
                    term.status().name(), term.current(),
                    term.status().allowedTransitions().stream().map(Enum::name).sorted().toList(),
                    term.status().isEditable(), term.version());
        }
    }
}
