package io.sankofa.school.school.api;

import io.sankofa.school.school.application.CampusService;
import io.sankofa.school.school.domain.Campus;
import io.sankofa.school.school.domain.Campus.Address;
import io.sankofa.school.school.domain.Campus.CampusStatus;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
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
 * Campuses.
 *
 * <p>As with the academic calendar, state changes are POSTs to named sub-resources rather than a
 * PATCH that sets a status field: "close this campus" has preconditions and an audit entry, and
 * is not a field assignment.
 */
@RestController
@RequestMapping("/api/v1/campuses")
@Tag(name = "School settings", description = "Campuses and branding")
public class CampusController {

    private final CampusService campuses;

    public CampusController(CampusService campuses) {
        this.campuses = campuses;
    }

    @GetMapping
    @Operation(summary = "List campuses, main campus first")
    public List<CampusResponse> list() {
        return campuses.list().stream().map(CampusResponse::from).toList();
    }

    @GetMapping("/{id}")
    @Operation(summary = "One campus")
    public CampusResponse get(@PathVariable UUID id) {
        return CampusResponse.from(campuses.get(id));
    }

    @PostMapping
    @Operation(summary = "Add a campus")
    public ResponseEntity<CampusResponse> create(@Valid @RequestBody CreateCampusRequest request) {
        Campus created = campuses.create(request.code(), request.name(), request.toAddress(),
                request.phoneE164(), request.email(), request.timezone(), request.openedOn());
        return ResponseEntity.status(HttpStatus.CREATED).body(CampusResponse.from(created));
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a campus")
    public CampusResponse update(@PathVariable UUID id,
                                 @Valid @RequestBody UpdateCampusRequest request) {
        return CampusResponse.from(campuses.update(id, request.name(), request.toAddress(),
                request.phoneE164(), request.email(), request.timezone(), request.openedOn(),
                request.version()));
    }

    @PostMapping("/{id}/make-main")
    @Operation(summary = "Make this the main campus")
    public CampusResponse makeMain(@PathVariable UUID id) {
        return CampusResponse.from(campuses.setMain(id));
    }

    @PostMapping("/{id}/suspend")
    @Operation(summary = "Temporarily stop using a campus")
    public CampusResponse suspend(@PathVariable UUID id) {
        return CampusResponse.from(campuses.changeStatus(id, CampusStatus.INACTIVE, null));
    }

    @PostMapping("/{id}/reopen")
    @Operation(summary = "Bring a campus back into use")
    public CampusResponse reopen(@PathVariable UUID id) {
        return CampusResponse.from(campuses.changeStatus(id, CampusStatus.ACTIVE, null));
    }

    @PostMapping("/{id}/close")
    @Operation(summary = "Close a campus permanently")
    public CampusResponse close(@PathVariable UUID id,
                                @Valid @RequestBody AcademicYearController.ReasonRequest request) {
        return CampusResponse.from(
                campuses.changeStatus(id, CampusStatus.CLOSED, request.reason()));
    }

    // ===================================================================================

    /** Shared by create and update, so the two cannot drift apart on validation. */
    public interface CampusDetails {
        String addressLine1();

        String addressLine2();

        String city();

        String region();

        String postalCode();

        String countryCode();

        default Address toAddress() {
            return new Address(addressLine1(), addressLine2(), city(), region(), postalCode(),
                    countryCode());
        }
    }

    public record CreateCampusRequest(
            @NotBlank(message = "is required")
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$",
                    message = "may contain letters, digits, hyphens and underscores only")
            String code,

            @NotBlank(message = "is required") @Size(max = 160) String name,

            String addressLine1,
            String addressLine2,
            String city,
            String region,
            String postalCode,

            @Pattern(regexp = "^[A-Z]{2}$", message = "must be a two-letter country code")
            String countryCode,

            @Pattern(regexp = "^\\+[1-9][0-9]{6,14}$",
                    message = "must be in international format, such as +233201234567")
            String phoneE164,

            @Email(message = "must be a valid email address") String email,
            String timezone,
            LocalDate openedOn) implements CampusDetails {
    }

    public record UpdateCampusRequest(
            @NotBlank(message = "is required") @Size(max = 160) String name,
            String addressLine1,
            String addressLine2,
            String city,
            String region,
            String postalCode,
            @Pattern(regexp = "^[A-Z]{2}$", message = "must be a two-letter country code")
            String countryCode,
            @Pattern(regexp = "^\\+[1-9][0-9]{6,14}$",
                    message = "must be in international format, such as +233201234567")
            String phoneE164,
            @Email(message = "must be a valid email address") String email,
            String timezone,
            LocalDate openedOn,
            long version) implements CampusDetails {
    }

    public record CampusResponse(
            UUID id,
            String code,
            String name,
            boolean main,
            String status,
            String addressLine1,
            String addressLine2,
            String city,
            String region,
            String postalCode,
            String countryCode,
            String phoneE164,
            String email,
            String timezone,
            LocalDate openedOn,
            LocalDate closedOn,
            long version) {

        static CampusResponse from(Campus campus) {
            Address address = campus.address();
            return new CampusResponse(
                    campus.id(), campus.code(), campus.name(), campus.main(),
                    campus.status().name(),
                    address.line1(), address.line2(), address.city(), address.region(),
                    address.postalCode(), address.countryCode(),
                    campus.phoneE164(), campus.email(), campus.timezone(),
                    campus.openedOn(), campus.closedOn(), campus.version());
        }
    }
}
