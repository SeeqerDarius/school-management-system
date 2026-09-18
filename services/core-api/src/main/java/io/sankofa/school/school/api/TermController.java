package io.sankofa.school.school.api;

import io.sankofa.school.school.api.AcademicYearController.ReasonRequest;
import io.sankofa.school.school.api.AcademicYearController.TermResponse;
import io.sankofa.school.school.application.AcademicCalendarService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Operations on an individual term.
 *
 * <p>Creating and listing terms belongs to their academic year and lives on
 * {@link AcademicYearController}; acting on one that already exists does not need the year in the
 * path, because the term's id already identifies it and the tenant comes from the session.
 */
@RestController
@RequestMapping("/api/v1/terms")
@Tag(name = "Academic calendar", description = "Academic years and terms")
public class TermController {

    private final AcademicCalendarService calendar;

    public TermController(AcademicCalendarService calendar) {
        this.calendar = calendar;
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a planned term")
    public TermResponse update(@PathVariable UUID id,
                               @Valid @RequestBody UpdateTermRequest request) {
        return TermResponse.from(calendar.updateTerm(id, request.code(), request.name(),
                request.startsOn(), request.endsOn(), request.reportsDueOn(), request.version()));
    }

    @PostMapping("/{id}/activate")
    @Operation(summary = "Put a term into use")
    public TermResponse activate(@PathVariable UUID id) {
        return TermResponse.from(calendar.activateTerm(id));
    }

    @PostMapping("/{id}/close")
    @Operation(summary = "Close a term permanently")
    public TermResponse close(@PathVariable UUID id, @Valid @RequestBody ReasonRequest request) {
        return TermResponse.from(calendar.closeTerm(id, request.reason()));
    }

    @PostMapping("/{id}/make-current")
    @Operation(summary = "Make this the term new work defaults to")
    public TermResponse makeCurrent(@PathVariable UUID id) {
        return TermResponse.from(calendar.makeTermCurrent(id));
    }

    public record UpdateTermRequest(
            @NotBlank(message = "is required") @Size(max = 32) String code,
            @NotBlank(message = "is required") @Size(max = 120) String name,
            @NotNull(message = "is required") LocalDate startsOn,
            @NotNull(message = "is required") LocalDate endsOn,
            LocalDate reportsDueOn,
            long version) {
    }
}
