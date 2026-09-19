package io.sankofa.school.school.repository;

import io.sankofa.school.school.domain.Branding;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/** Persistence for {@link Branding}. One row per tenant. */
@Repository
public class BrandingRepository {

    private static final String COLUMNS = """
            tenant_id, motto, logo_path, logo_updated_at, primary_color, accent_color,
            report_card_header, receipt_header, invoice_header, document_footer,
            head_signature_name, head_signature_title, website, version
            """;

    private static final RowMapper<Branding> MAPPER = BrandingRepository::mapRow;

    private final JdbcClient jdbc;

    public BrandingRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Branding> find(UUID tenantId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.branding
                 WHERE tenant_id = :tenantId
                """)
                .param("tenantId", tenantId)
                .query(MAPPER)
                .optional();
    }

    /**
     * Inserts or updates in one statement.
     *
     * <p>{@code ON CONFLICT} rather than a read-then-branch: two administrators saving settings
     * at the same moment would both find no row and both insert, and one would fail on the
     * primary key. The optimistic-lock check is applied in the WHERE of the update arm, so a
     * genuine concurrent edit is still caught rather than silently overwritten.
     */
    public void upsert(Branding branding) {
        int affected = jdbc.sql("""
                INSERT INTO school.branding
                    (tenant_id, motto, logo_path, primary_color, accent_color,
                     report_card_header, receipt_header, invoice_header, document_footer,
                     head_signature_name, head_signature_title, website)
                VALUES (:tenantId, :motto, :logoPath, :primaryColor, :accentColor,
                        :reportCardHeader, :receiptHeader, :invoiceHeader, :documentFooter,
                        :headSignatureName, :headSignatureTitle, :website)
                ON CONFLICT (tenant_id) DO UPDATE SET
                    motto = excluded.motto,
                    logo_path = excluded.logo_path,
                    primary_color = excluded.primary_color,
                    accent_color = excluded.accent_color,
                    report_card_header = excluded.report_card_header,
                    receipt_header = excluded.receipt_header,
                    invoice_header = excluded.invoice_header,
                    document_footer = excluded.document_footer,
                    head_signature_name = excluded.head_signature_name,
                    head_signature_title = excluded.head_signature_title,
                    website = excluded.website
                WHERE school.branding.version = :version
                """)
                .param("tenantId", branding.tenantId())
                .param("motto", branding.motto())
                .param("logoPath", branding.logoPath())
                .param("primaryColor", branding.primaryColor())
                .param("accentColor", branding.accentColor())
                .param("reportCardHeader", branding.reportCardHeader())
                .param("receiptHeader", branding.receiptHeader())
                .param("invoiceHeader", branding.invoiceHeader())
                .param("documentFooter", branding.documentFooter())
                .param("headSignatureName", branding.headSignatureName())
                .param("headSignatureTitle", branding.headSignatureTitle())
                .param("website", branding.website())
                .param("version", branding.version())
                .update();

        if (affected == 0) {
            throw new OptimisticLockingFailureException(
                    "Branding was changed by someone else; reload and try again");
        }
    }

    /**
     * Records a newly uploaded logo.
     *
     * <p>Separate from {@link #upsert} because a logo upload is its own action with its own
     * audit entry, and folding it into a general settings save would make "who changed the
     * crest" unanswerable.
     */
    public void updateLogo(UUID tenantId, String logoPath) {
        jdbc.sql("""
                INSERT INTO school.branding (tenant_id, logo_path, logo_updated_at)
                VALUES (:tenantId, :logoPath, now())
                ON CONFLICT (tenant_id) DO UPDATE SET
                    logo_path = excluded.logo_path,
                    logo_updated_at = now()
                """)
                .param("tenantId", tenantId)
                .param("logoPath", logoPath)
                .update();
    }

    private static Branding mapRow(ResultSet rs, int rowNum) throws SQLException {
        OffsetDateTime logoUpdatedAt = rs.getObject("logo_updated_at", OffsetDateTime.class);
        return new Branding(
                rs.getObject("tenant_id", UUID.class),
                rs.getString("motto"),
                rs.getString("logo_path"),
                logoUpdatedAt == null ? null : logoUpdatedAt.toInstant(),
                rs.getString("primary_color"),
                rs.getString("accent_color"),
                rs.getString("report_card_header"),
                rs.getString("receipt_header"),
                rs.getString("invoice_header"),
                rs.getString("document_footer"),
                rs.getString("head_signature_name"),
                rs.getString("head_signature_title"),
                rs.getString("website"),
                rs.getLong("version"));
    }
}
