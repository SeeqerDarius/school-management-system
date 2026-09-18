package io.sankofa.school.school.application;

import io.sankofa.school.audit.AuditFacade;
import io.sankofa.school.audit.AuditFacade.AuditRecord;
import io.sankofa.school.identity.authz.Permissions;
import io.sankofa.school.identity.authz.RequiresPermission;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.platform.id.Ids;
import io.sankofa.school.school.domain.AcademicYear;
import io.sankofa.school.school.domain.CalendarStatus;
import io.sankofa.school.school.domain.Term;
import io.sankofa.school.school.repository.AcademicYearRepository;
import io.sankofa.school.school.repository.TermRepository;
import io.sankofa.school.tenancy.TenantContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The academic calendar: years and the terms inside them.
 *
 * <p>This is the reference pattern for every business module that follows. It shows, in one
 * place, the five things each of them has to get right:
 *
 * <ol>
 *   <li><b>Authorization first.</b> {@code @RequiresPermission} is evaluated before the
 *       transaction opens, so a denied call never takes a lock.</li>
 *   <li><b>Tenant from the context, never the caller.</b> Every repository call is given the
 *       tenant resolved from the verified membership.</li>
 *   <li><b>State machine, not booleans.</b> Transitions go through {@link CalendarStatus}, which
 *       has exactly one definition of what is legal.</li>
 *   <li><b>Audit inside the transaction.</b> The entry and the change commit together or not
 *       at all.</li>
 *   <li><b>Errors a person can act on.</b> "The term ends after the academic year does" beats a
 *       constraint-violation message nobody outside the team can interpret.</li>
 * </ol>
 */
@Service
public class AcademicCalendarService {

    private static final Logger log = LoggerFactory.getLogger(AcademicCalendarService.class);

    private static final String YEAR = "Academic year";
    private static final String TERM = "Term";

    private final AcademicYearRepository years;
    private final TermRepository terms;
    private final AuditFacade audit;

    public AcademicCalendarService(AcademicYearRepository years, TermRepository terms,
                                   AuditFacade audit) {
        this.years = years;
        this.terms = terms;
        this.audit = audit;
    }

    // ===================================================================================
    // Academic years
    // ===================================================================================

    @RequiresPermission(Permissions.ACADEMIC_YEAR_VIEW)
    @Transactional(readOnly = true)
    public List<AcademicYear> listYears() {
        return years.findAll(tenantId());
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_VIEW)
    @Transactional(readOnly = true)
    public AcademicYear getYear(UUID id) {
        return years.findById(tenantId(), id).orElseThrow(() -> ApiException.notFound(YEAR));
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_VIEW)
    @Transactional(readOnly = true)
    public AcademicYear currentYear() {
        return years.findCurrent(tenantId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND,
                        "No academic year has been marked as current"));
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public AcademicYear createYear(String code, String name, LocalDate startsOn,
                                   LocalDate endsOn) {
        UUID tenantId = tenantId();
        AcademicYear.validateRange(startsOn, endsOn);

        // Checked here so the caller gets a message naming the field, rather than a unique
        // index violation. The index remains the actual guarantee under concurrency.
        if (years.codeExists(tenantId, code)) {
            throw ApiException.validation("An academic year with that code already exists",
                    Map.of("code", "is already in use"));
        }

        AcademicYear year = new AcademicYear(Ids.newId(), tenantId, code.trim(), name.trim(),
                startsOn, endsOn, CalendarStatus.PLANNED, false, null, null, 0L);

        years.insert(year);
        audit.record(AuditRecord.of("ACADEMIC_YEAR_CREATED", "AcademicYear", year.id(), year.code())
                .withChange(null, Map.of(
                        "code", year.code(),
                        "name", year.name(),
                        "startsOn", year.startsOn().toString(),
                        "endsOn", year.endsOn().toString())));

        log.info("Academic year {} created for tenant {}", year.code(), tenantId);
        return year;
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public AcademicYear updateYear(UUID id, String code, String name, LocalDate startsOn,
                                   LocalDate endsOn, long version) {
        UUID tenantId = tenantId();
        AcademicYear existing = years.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(YEAR));

        // Once a year is in use, attendance, marks and invoices already reference it; moving its
        // boundaries would silently re-scope data that has already been reported on.
        existing.requireEditable();
        AcademicYear.validateRange(startsOn, endsOn);

        if (!existing.code().equalsIgnoreCase(code) && years.codeExists(tenantId, code)) {
            throw ApiException.validation("An academic year with that code already exists",
                    Map.of("code", "is already in use"));
        }

        AcademicYear updated = new AcademicYear(id, tenantId, code.trim(), name.trim(),
                startsOn, endsOn, existing.status(), existing.current(),
                existing.closedAt(), existing.closedBy(), version);

        years.update(updated);
        audit.record(AuditRecord.of("ACADEMIC_YEAR_UPDATED", "AcademicYear", id, code)
                .withChange(
                        Map.of("code", existing.code(), "name", existing.name(),
                                "startsOn", existing.startsOn().toString(),
                                "endsOn", existing.endsOn().toString()),
                        Map.of("code", updated.code(), "name", updated.name(),
                                "startsOn", updated.startsOn().toString(),
                                "endsOn", updated.endsOn().toString())));

        return years.findById(tenantId, id).orElseThrow();
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public AcademicYear activateYear(UUID id) {
        UUID tenantId = tenantId();
        AcademicYear year = years.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(YEAR));

        year.status().requireTransitionTo(CalendarStatus.ACTIVE, YEAR);

        years.updateStatus(tenantId, id, CalendarStatus.ACTIVE, year.version(), null);
        audit.record(AuditRecord.of("ACADEMIC_YEAR_ACTIVATED", "AcademicYear", id, year.code()));

        log.info("Academic year {} activated for tenant {}", year.code(), tenantId);
        return years.findById(tenantId, id).orElseThrow();
    }

    /**
     * Closes a year. Requires a reason (§188), and refuses while any term is still open.
     *
     * <p>Closing is one-way. Reopening would change what an already-issued report card means,
     * so it is deliberately not offered here.
     */
    @RequiresPermission(value = Permissions.ACADEMIC_YEAR_MANAGE, requiresReason = true)
    @Transactional
    public AcademicYear closeYear(UUID id, String reason) {
        UUID tenantId = tenantId();
        requireReason(reason);

        AcademicYear year = years.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(YEAR));
        year.status().requireTransitionTo(CalendarStatus.CLOSED, YEAR);

        // Closing a year whose terms are still open would leave terms accepting work against a
        // year that no longer does — an inconsistency nothing downstream could interpret.
        if (years.hasOpenTerms(tenantId, id)) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Close every term in this academic year before closing the year itself");
        }

        years.updateStatus(tenantId, id, CalendarStatus.CLOSED, year.version(), currentUserId());
        audit.record(AuditRecord.of("ACADEMIC_YEAR_CLOSED", "AcademicYear", id, year.code())
                .withReason(reason));

        log.info("Academic year {} closed for tenant {}", year.code(), tenantId);
        return years.findById(tenantId, id).orElseThrow();
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public AcademicYear makeYearCurrent(UUID id) {
        UUID tenantId = tenantId();
        AcademicYear year = years.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(YEAR));

        // "Current" means "where new work goes". A planned year is not ready for that, and a
        // closed one must never be.
        if (year.status() != CalendarStatus.ACTIVE) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Only an active academic year can be made the current one");
        }

        years.makeCurrent(tenantId, id);
        audit.record(AuditRecord.of("ACADEMIC_YEAR_SET_CURRENT", "AcademicYear", id, year.code()));
        return years.findById(tenantId, id).orElseThrow();
    }

    // ===================================================================================
    // Terms
    // ===================================================================================

    @RequiresPermission(Permissions.ACADEMIC_YEAR_VIEW)
    @Transactional(readOnly = true)
    public List<Term> listTerms(UUID academicYearId) {
        UUID tenantId = tenantId();
        // Resolve the year first so an unknown or foreign id yields 404 rather than an empty
        // list, which would be indistinguishable from "a year with no terms yet".
        years.findById(tenantId, academicYearId).orElseThrow(() -> ApiException.notFound(YEAR));
        return terms.findByYear(tenantId, academicYearId);
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public Term createTerm(UUID academicYearId, String code, String name, LocalDate startsOn,
                           LocalDate endsOn, LocalDate reportsDueOn, Integer sequence) {
        UUID tenantId = tenantId();
        AcademicYear year = years.findById(tenantId, academicYearId)
                .orElseThrow(() -> ApiException.notFound(YEAR));

        if (year.status().isClosed()) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Terms cannot be added to a closed academic year");
        }

        Term.validateWithin(year, startsOn, endsOn, reportsDueOn);

        int resolvedSequence = sequence != null
                ? sequence
                : terms.nextSequence(tenantId, academicYearId);

        Term term = new Term(Ids.newId(), tenantId, academicYearId, resolvedSequence,
                code.trim(), name.trim(), startsOn, endsOn, CalendarStatus.PLANNED, false,
                reportsDueOn, null, null, 0L);

        terms.insert(term);
        audit.record(AuditRecord.of("TERM_CREATED", "Term", term.id(), term.code())
                .withChange(null, Map.of(
                        "academicYear", year.code(),
                        "sequence", resolvedSequence,
                        "startsOn", startsOn.toString(),
                        "endsOn", endsOn.toString())));

        return term;
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public Term updateTerm(UUID id, String code, String name, LocalDate startsOn,
                           LocalDate endsOn, LocalDate reportsDueOn, long version) {
        UUID tenantId = tenantId();
        Term existing = terms.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(TERM));
        existing.requireEditable();

        AcademicYear year = years.findById(tenantId, existing.academicYearId())
                .orElseThrow(() -> ApiException.notFound(YEAR));
        Term.validateWithin(year, startsOn, endsOn, reportsDueOn);

        Term updated = new Term(id, tenantId, existing.academicYearId(), existing.sequence(),
                code.trim(), name.trim(), startsOn, endsOn, existing.status(), existing.current(),
                reportsDueOn, existing.closedAt(), existing.closedBy(), version);

        terms.update(updated);
        audit.record(AuditRecord.of("TERM_UPDATED", "Term", id, code)
                .withChange(
                        Map.of("startsOn", existing.startsOn().toString(),
                                "endsOn", existing.endsOn().toString()),
                        Map.of("startsOn", startsOn.toString(),
                                "endsOn", endsOn.toString())));

        return terms.findById(tenantId, id).orElseThrow();
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public Term activateTerm(UUID id) {
        UUID tenantId = tenantId();
        Term term = terms.findById(tenantId, id).orElseThrow(() -> ApiException.notFound(TERM));
        term.status().requireTransitionTo(CalendarStatus.ACTIVE, TERM);

        AcademicYear year = years.findById(tenantId, term.academicYearId())
                .orElseThrow(() -> ApiException.notFound(YEAR));
        // A term cannot be in use before the year that contains it is.
        if (year.status() != CalendarStatus.ACTIVE) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Activate the academic year before activating a term within it");
        }

        terms.updateStatus(tenantId, id, CalendarStatus.ACTIVE, term.version(), null);
        audit.record(AuditRecord.of("TERM_ACTIVATED", "Term", id, term.code()));
        return terms.findById(tenantId, id).orElseThrow();
    }

    @RequiresPermission(value = Permissions.ACADEMIC_YEAR_MANAGE, requiresReason = true)
    @Transactional
    public Term closeTerm(UUID id, String reason) {
        UUID tenantId = tenantId();
        requireReason(reason);

        Term term = terms.findById(tenantId, id).orElseThrow(() -> ApiException.notFound(TERM));
        term.status().requireTransitionTo(CalendarStatus.CLOSED, TERM);

        terms.updateStatus(tenantId, id, CalendarStatus.CLOSED, term.version(), currentUserId());
        audit.record(AuditRecord.of("TERM_CLOSED", "Term", id, term.code()).withReason(reason));

        log.info("Term {} closed for tenant {}", term.code(), tenantId);
        return terms.findById(tenantId, id).orElseThrow();
    }

    @RequiresPermission(Permissions.ACADEMIC_YEAR_MANAGE)
    @Transactional
    public Term makeTermCurrent(UUID id) {
        UUID tenantId = tenantId();
        Term term = terms.findById(tenantId, id).orElseThrow(() -> ApiException.notFound(TERM));

        if (term.status() != CalendarStatus.ACTIVE) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Only an active term can be made the current one");
        }

        terms.makeCurrent(tenantId, id);
        audit.record(AuditRecord.of("TERM_SET_CURRENT", "Term", id, term.code()));
        return terms.findById(tenantId, id).orElseThrow();
    }

    // ===================================================================================

    private static UUID tenantId() {
        return TenantContextHolder.require().requireTenantId();
    }

    private static UUID currentUserId() {
        return TenantContextHolder.require().userId();
    }

    /**
     * High-risk actions carry a reason into the audit trail (§188).
     *
     * <p>Enforced here rather than by a {@code @NotBlank} on the DTO so that the rule lives with
     * the operation it protects, and holds for any caller — including a future background job
     * that has no DTO at all.
     */
    private static void requireReason(String reason) {
        if (reason == null || reason.isBlank() || reason.trim().length() < 3) {
            throw ApiException.validation("A reason is required for this action",
                    Map.of("reason", "is required and must be meaningful"));
        }
    }

}
