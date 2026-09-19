package io.sankofa.school.school.application;

import io.sankofa.school.audit.AuditFacade;
import io.sankofa.school.audit.AuditFacade.AuditRecord;
import io.sankofa.school.identity.authz.Permissions;
import io.sankofa.school.identity.authz.RequiresPermission;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.platform.error.ErrorCode;
import io.sankofa.school.platform.id.Ids;
import io.sankofa.school.school.domain.Campus;
import io.sankofa.school.school.domain.Campus.Address;
import io.sankofa.school.school.domain.Campus.CampusStatus;
import io.sankofa.school.school.repository.CampusRepository;
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
 * Campuses (§138).
 *
 * <p>Follows the pattern established by {@link AcademicCalendarService}: permission first,
 * tenant from the context, explicit lifecycle, audit inside the transaction, and errors a person
 * can act on.
 *
 * <p>Two rules here exist to stop a school reaching a state it cannot get out of through the UI:
 * the first campus created becomes the main one automatically, and the main campus cannot be
 * closed while it still holds that designation. Without the first, a new school has no main
 * campus and every report header is unattributed; without the second, a school can close its way
 * into having none.
 */
@Service
public class CampusService {

    private static final Logger log = LoggerFactory.getLogger(CampusService.class);
    private static final String CAMPUS = "Campus";

    private final CampusRepository campuses;
    private final AuditFacade audit;

    public CampusService(CampusRepository campuses, AuditFacade audit) {
        this.campuses = campuses;
        this.audit = audit;
    }

    @RequiresPermission(Permissions.TENANT_SETTINGS_VIEW)
    @Transactional(readOnly = true)
    public List<Campus> list() {
        return campuses.findAll(tenantId());
    }

    @RequiresPermission(Permissions.TENANT_SETTINGS_VIEW)
    @Transactional(readOnly = true)
    public Campus get(UUID id) {
        return campuses.findById(tenantId(), id).orElseThrow(() -> ApiException.notFound(CAMPUS));
    }

    @RequiresPermission(Permissions.TENANT_CAMPUS_MANAGE)
    @Transactional
    public Campus create(String code, String name, Address address, String phoneE164,
                         String email, String timezone, LocalDate openedOn) {
        UUID tenantId = tenantId();
        String normalisedCode = code.trim().toUpperCase(java.util.Locale.ROOT);

        if (campuses.codeExists(tenantId, normalisedCode)) {
            throw ApiException.validation("A campus with that code already exists",
                    Map.of("code", "is already in use"));
        }

        // The first campus is the main one. A single-site school then never has to think about
        // the concept, and a multi-site school starts from a sensible default rather than a
        // state where no campus is designated.
        boolean isFirst = campuses.findMain(tenantId).isEmpty();

        Campus campus = new Campus(Ids.newId(), tenantId, normalisedCode, name.trim(), isFirst,
                CampusStatus.ACTIVE, address == null ? Address.EMPTY : address,
                blankToNull(phoneE164), blankToNull(email), blankToNull(timezone), openedOn, null,
                0L);

        campuses.insert(campus);
        audit.record(AuditRecord.of("CAMPUS_CREATED", "Campus", campus.id(), campus.code())
                .withChange(null, Map.of("code", campus.code(), "name", campus.name(),
                        "isMain", isFirst)));

        log.info("Campus {} created for tenant {} (main={})", campus.code(), tenantId, isFirst);
        return campus;
    }

    @RequiresPermission(Permissions.TENANT_CAMPUS_MANAGE)
    @Transactional
    public Campus update(UUID id, String name, Address address, String phoneE164, String email,
                         String timezone, LocalDate openedOn, long version) {
        UUID tenantId = tenantId();
        Campus existing = campuses.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(CAMPUS));

        Campus updated = new Campus(id, tenantId, existing.code(), name.trim(), existing.main(),
                existing.status(), address == null ? Address.EMPTY : address,
                blankToNull(phoneE164), blankToNull(email), blankToNull(timezone), openedOn,
                existing.closedOn(), version);

        campuses.update(updated);
        audit.record(AuditRecord.of("CAMPUS_UPDATED", "Campus", id, existing.code())
                .withChange(Map.of("name", existing.name()), Map.of("name", updated.name())));

        return campuses.findById(tenantId, id).orElseThrow();
    }

    /**
     * Moves the main-campus designation.
     *
     * <p>Only an active campus may hold it: a closed campus as the address on every invoice and
     * report card would be wrong in a way nobody notices until a parent posts a cheque to it.
     */
    @RequiresPermission(Permissions.TENANT_CAMPUS_MANAGE)
    @Transactional
    public Campus setMain(UUID id) {
        UUID tenantId = tenantId();
        Campus campus = campuses.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(CAMPUS));

        if (campus.status() != CampusStatus.ACTIVE) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Only an active campus can be the main campus");
        }

        campuses.setMain(tenantId, id);
        audit.record(AuditRecord.of("CAMPUS_SET_MAIN", "Campus", id, campus.code()));
        return campuses.findById(tenantId, id).orElseThrow();
    }

    @RequiresPermission(Permissions.TENANT_CAMPUS_MANAGE)
    @Transactional
    public Campus changeStatus(UUID id, CampusStatus target, String reason) {
        UUID tenantId = tenantId();
        Campus campus = campuses.findById(tenantId, id)
                .orElseThrow(() -> ApiException.notFound(CAMPUS));

        if (campus.status() == target) {
            throw ApiException.invalidTransition(CAMPUS, campus.status().name(), target.name());
        }

        // A school must always have somewhere to be. Closing or suspending the main campus
        // without first designating another would leave every report header unattributed.
        if (campus.main() && target != CampusStatus.ACTIVE) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Make another campus the main one before closing this one");
        }

        if (target == CampusStatus.CLOSED) {
            requireReason(reason);
        }

        campuses.updateStatus(tenantId, id, target, campus.version());
        AuditRecord record = AuditRecord.of("CAMPUS_" + target.name(), "Campus", id, campus.code())
                .withChange(Map.of("status", campus.status().name()),
                        Map.of("status", target.name()));
        audit.record(reason == null || reason.isBlank() ? record : record.withReason(reason));

        log.info("Campus {} moved to {} for tenant {}", campus.code(), target, tenantId);
        return campuses.findById(tenantId, id).orElseThrow();
    }

    // ===================================================================================

    private static UUID tenantId() {
        return TenantContextHolder.require().requireTenantId();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static void requireReason(String reason) {
        if (reason == null || reason.trim().length() < 3) {
            throw ApiException.validation("A reason is required to close a campus",
                    Map.of("reason", "is required and must be meaningful"));
        }
    }
}
