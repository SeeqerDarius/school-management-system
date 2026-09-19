package io.sankofa.school.school.api;

import io.sankofa.school.school.application.BrandingService;
import io.sankofa.school.school.domain.BrandColor;
import io.sankofa.school.school.domain.Branding;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * School branding.
 *
 * <p>The response carries {@code primaryInk} — the text colour that is readable on the school's
 * primary colour — computed rather than stored. That is what lets a report card, a receipt and
 * the web UI all use the school's own colour without any of them having to work out whether to
 * put black or white on it, and without the answer drifting out of step with the colour.
 */
@RestController
@RequestMapping("/api/v1/branding")
@Tag(name = "School settings", description = "Campuses and branding")
public class BrandingController {

    private final BrandingService branding;

    public BrandingController(BrandingService branding) {
        this.branding = branding;
    }

    @GetMapping
    @Operation(summary = "The school's branding, or platform defaults if none is set")
    public BrandingResponse get() {
        return BrandingResponse.from(branding.get());
    }

    @PutMapping
    @Operation(summary = "Update branding")
    public BrandingResponse update(@Valid @RequestBody UpdateBrandingRequest request) {
        return BrandingResponse.from(branding.update(request.toBranding()));
    }

    @PostMapping("/logo")
    @Operation(summary = "Record a logo that has already been stored")
    public BrandingResponse recordLogo(@Valid @RequestBody RecordLogoRequest request) {
        return BrandingResponse.from(branding.recordLogo(request.logoPath()));
    }

    // ===================================================================================

    public record UpdateBrandingRequest(
            @Size(max = 200) String motto,
            // Colour format is validated in the domain rather than here, so that the error
            // message can explain *why* a colour was refused instead of only that it was.
            String primaryColor,
            String accentColor,
            @Size(max = 300) String reportCardHeader,
            @Size(max = 300) String receiptHeader,
            @Size(max = 300) String invoiceHeader,
            @Size(max = 300) String documentFooter,
            @Size(max = 120) String headSignatureName,
            @Size(max = 120) String headSignatureTitle,
            @Size(max = 200) String website,
            long version) {

        Branding toBranding() {
            return new Branding(null, motto, null, null, primaryColor, accentColor,
                    reportCardHeader, receiptHeader, invoiceHeader, documentFooter,
                    headSignatureName, headSignatureTitle, website, version);
        }
    }

    public record RecordLogoRequest(
            @NotBlank(message = "is required") @Size(max = 500) String logoPath) {
    }

    public record BrandingResponse(
            String motto,
            String logoPath,
            Instant logoUpdatedAt,
            boolean hasLogo,
            String primaryColor,
            /** Readable text colour for the primary colour. Computed, never stored. */
            String primaryInk,
            String accentColor,
            String reportCardHeader,
            String receiptHeader,
            String invoiceHeader,
            String documentFooter,
            String headSignatureName,
            String headSignatureTitle,
            String website,
            /** How the accent colour reads against the page, so the UI can show it. */
            Double accentContrastOnPage,
            long version) {

        static BrandingResponse from(Branding branding) {
            Double accentContrast = branding.accentColor() == null
                    ? null
                    : BrandColor.parse(branding.accentColor(), "accentColor")
                            .contrastRatio(BrandColor.lightSurface());

            return new BrandingResponse(
                    branding.motto(), branding.logoPath(), branding.logoUpdatedAt(),
                    branding.hasLogo(), branding.primaryColor(), branding.primaryInk(),
                    branding.accentColor(), branding.reportCardHeader(), branding.receiptHeader(),
                    branding.invoiceHeader(), branding.documentFooter(),
                    branding.headSignatureName(), branding.headSignatureTitle(),
                    branding.website(),
                    accentContrast == null ? null : Math.round(accentContrast * 10) / 10.0,
                    branding.version());
        }
    }
}
