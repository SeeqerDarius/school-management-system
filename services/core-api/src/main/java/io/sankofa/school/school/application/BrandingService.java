package io.sankofa.school.school.application;

import io.sankofa.school.audit.AuditFacade;
import io.sankofa.school.audit.AuditFacade.AuditRecord;
import io.sankofa.school.identity.authz.Permissions;
import io.sankofa.school.identity.authz.RequiresPermission;
import io.sankofa.school.platform.error.ApiException;
import io.sankofa.school.school.domain.BrandColor;
import io.sankofa.school.school.domain.Branding;
import io.sankofa.school.school.repository.BrandingRepository;
import io.sankofa.school.tenancy.TenantContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * School branding (§8), with the accessibility constraint §94 asks for.
 *
 * <p>The colour rules are worth stating, because they are asymmetric on purpose:
 *
 * <ul>
 *   <li><b>Primary colour</b> — used as a background for buttons, headers and the report-card
 *       masthead. Accepted unconditionally. The readable text colour is computed from it, and
 *       the arithmetic guarantees one always exists (see {@link BrandColor}).</li>
 *   <li><b>Accent colour</b> — used as link and emphasis text on the page. Must be readable on
 *       the page, and is rejected with advice when it is not. A light gold simply cannot be
 *       link text on white, and no amount of pairing fixes it.</li>
 * </ul>
 *
 * <p>So a school's real colours are honoured wherever they can be, and refused only where the
 * result would be unreadable — which is the difference between constraining a colour to
 * accessible usage and rejecting it outright.
 */
@Service
public class BrandingService {

    private static final Logger log = LoggerFactory.getLogger(BrandingService.class);

    private final BrandingRepository branding;
    private final AuditFacade audit;

    public BrandingService(BrandingRepository branding, AuditFacade audit) {
        this.branding = branding;
        this.audit = audit;
    }

    /**
     * The tenant's branding, or empty defaults.
     *
     * <p>Returns a populated record rather than an empty Optional so that every caller —
     * report-card rendering, receipt headers, the settings screen — has the same shape to work
     * with and none of them has to decide what "no branding configured" looks like.
     */
    @RequiresPermission(Permissions.TENANT_SETTINGS_VIEW)
    @Transactional(readOnly = true)
    public Branding get() {
        UUID tenantId = tenantId();
        return branding.find(tenantId).orElseGet(() -> Branding.empty(tenantId));
    }

    @RequiresPermission(Permissions.TENANT_BRANDING_MANAGE)
    @Transactional
    public Branding update(Branding submitted) {
        UUID tenantId = tenantId();
        Branding existing = branding.find(tenantId).orElseGet(() -> Branding.empty(tenantId));

        String primary = normaliseColor(submitted.primaryColor(), "primaryColor", false);
        String accent = normaliseColor(submitted.accentColor(), "accentColor", true);

        Branding toSave = new Branding(
                tenantId,
                trimToNull(submitted.motto()),
                existing.logoPath(),
                existing.logoUpdatedAt(),
                primary,
                accent,
                trimToNull(submitted.reportCardHeader()),
                trimToNull(submitted.receiptHeader()),
                trimToNull(submitted.invoiceHeader()),
                trimToNull(submitted.documentFooter()),
                trimToNull(submitted.headSignatureName()),
                trimToNull(submitted.headSignatureTitle()),
                trimToNull(submitted.website()),
                submitted.version());

        branding.upsert(toSave);

        audit.record(AuditRecord.of("BRANDING_UPDATED", "Branding", tenantId)
                .withChange(changeSummary(existing), changeSummary(toSave)));

        log.info("Branding updated for tenant {}", tenantId);
        return branding.find(tenantId).orElseThrow();
    }

    /**
     * Records a logo that has already been stored.
     *
     * <p>Takes a Storage path, not the bytes. Validation of MIME type, size, dimensions and
     * content happens in the documents module before anything reaches here; this only records
     * where the accepted object landed.
     *
     * <p><b>Status: the upload pipeline that would call this does not exist yet</b> — see
     * {@code IMPLEMENTATION_STATUS.md}. This method is the seam it will use.
     */
    @RequiresPermission(Permissions.TENANT_BRANDING_MANAGE)
    @Transactional
    public Branding recordLogo(String storagePath) {
        UUID tenantId = tenantId();
        if (storagePath == null || storagePath.isBlank()) {
            throw ApiException.validation("A logo path is required",
                    Map.of("logoPath", "is required"));
        }
        // A URL here would mean either a dead link within the hour or a public bucket. Both are
        // wrong, and catching it at the boundary is cheaper than discovering it in a report.
        if (storagePath.contains("://")) {
            throw ApiException.validation(
                    "A logo is referenced by its storage path, not by a URL",
                    Map.of("logoPath", "must be a storage path, not a URL"));
        }

        branding.updateLogo(tenantId, storagePath.trim());
        audit.record(AuditRecord.of("BRANDING_LOGO_UPDATED", "Branding", tenantId));

        return branding.find(tenantId).orElseThrow();
    }

    // ===================================================================================

    /**
     * @param mustBeReadableAsText whether this colour is used as text on the page, in which case
     *                             an unreadable value is refused rather than accepted
     */
    private static String normaliseColor(String hex, String field, boolean mustBeReadableAsText) {
        if (hex == null || hex.isBlank()) {
            return null;
        }
        BrandColor color = BrandColor.parse(hex, field);
        if (mustBeReadableAsText) {
            color.requireUsableAsForeground(BrandColor.lightSurface(), field);
        }
        return color.toHex();
    }

    /** Only the fields worth reconstructing later; the audit log is not a copy of the row. */
    private static Map<String, Object> changeSummary(Branding branding) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("motto", String.valueOf(branding.motto()));
        summary.put("primaryColor", String.valueOf(branding.primaryColor()));
        summary.put("accentColor", String.valueOf(branding.accentColor()));
        summary.put("reportCardHeader", String.valueOf(branding.reportCardHeader()));
        return summary;
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static UUID tenantId() {
        return TenantContextHolder.require().requireTenantId();
    }
}
