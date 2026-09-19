package io.sankofa.school.school.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A school's visual identity and the headings it prints on documents (§8).
 *
 * <p>One row per tenant. Every field is optional: a school that has entered nothing still gets a
 * usable product, with the platform's own defaults, rather than blank spaces where its name
 * should be.
 *
 * @param logoPath a path inside the private Storage bucket, never a URL. Access is granted by a
 *                 short-lived signed URL at render time (§68), so a stored URL would either be
 *                 dead within the hour or evidence the bucket is public
 */
public record Branding(
        UUID tenantId,
        String motto,
        String logoPath,
        Instant logoUpdatedAt,
        String primaryColor,
        String accentColor,
        String reportCardHeader,
        String receiptHeader,
        String invoiceHeader,
        String documentFooter,
        String headSignatureName,
        String headSignatureTitle,
        String website,
        long version) {

    /** What a tenant that has configured nothing gets. */
    public static Branding empty(UUID tenantId) {
        return new Branding(tenantId, null, null, null, null, null,
                null, null, null, null, null, null, null, 0L);
    }

    public boolean hasLogo() {
        return logoPath != null && !logoPath.isBlank();
    }

    /**
     * The text colour to print on the primary colour, as a hex string.
     *
     * <p>Computed rather than stored, so it cannot drift out of step with the colour it belongs
     * to — and so a school never has to pick it.
     */
    public String primaryInk() {
        if (primaryColor == null) {
            return null;
        }
        return BrandColor.parse(primaryColor, "primaryColor").readableInk().toHex();
    }
}
