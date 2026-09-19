package io.sankofa.school.school.repository;

import io.sankofa.school.school.domain.Campus;
import io.sankofa.school.school.domain.Campus.Address;
import io.sankofa.school.school.domain.Campus.CampusStatus;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence for {@link Campus}. Every statement carries its tenant predicate explicitly. */
@Repository
public class CampusRepository {

    private static final String COLUMNS = """
            id, tenant_id, code, name, is_main, status,
            address_line1, address_line2, city, region, postal_code, country_code,
            phone_e164, email, timezone, opened_on, closed_on, version
            """;

    private static final RowMapper<Campus> MAPPER = CampusRepository::mapRow;

    private final JdbcClient jdbc;

    public CampusRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<Campus> findAll(UUID tenantId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.campus
                 WHERE tenant_id = :tenantId
                 ORDER BY is_main DESC, name
                """)
                .param("tenantId", tenantId)
                .query(MAPPER)
                .list();
    }

    public Optional<Campus> findById(UUID tenantId, UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.campus
                 WHERE tenant_id = :tenantId AND id = :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .query(MAPPER)
                .optional();
    }

    public Optional<Campus> findMain(UUID tenantId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.campus
                 WHERE tenant_id = :tenantId AND is_main
                """)
                .param("tenantId", tenantId)
                .query(MAPPER)
                .optional();
    }

    public boolean codeExists(UUID tenantId, String code) {
        return jdbc.sql("""
                SELECT count(*) FROM school.campus
                 WHERE tenant_id = :tenantId AND upper(code) = upper(:code)
                """)
                .param("tenantId", tenantId)
                .param("code", code)
                .query(Long.class)
                .single() > 0;
    }

    public long countActive(UUID tenantId) {
        return jdbc.sql("""
                SELECT count(*) FROM school.campus
                 WHERE tenant_id = :tenantId AND status = 'ACTIVE'
                """)
                .param("tenantId", tenantId)
                .query(Long.class)
                .single();
    }

    public void insert(Campus campus) {
        jdbc.sql("""
                INSERT INTO school.campus
                    (id, tenant_id, code, name, is_main, status,
                     address_line1, address_line2, city, region, postal_code, country_code,
                     phone_e164, email, timezone, opened_on)
                VALUES (:id, :tenantId, :code, :name, :isMain, :status,
                        :line1, :line2, :city, :region, :postalCode, :countryCode,
                        :phone, :email, :timezone, :openedOn)
                """)
                .param("id", campus.id())
                .param("tenantId", campus.tenantId())
                .param("code", campus.code())
                .param("name", campus.name())
                .param("isMain", campus.main())
                .param("status", campus.status().name())
                .param("line1", campus.address().line1())
                .param("line2", campus.address().line2())
                .param("city", campus.address().city())
                .param("region", campus.address().region())
                .param("postalCode", campus.address().postalCode())
                .param("countryCode", campus.address().countryCode())
                .param("phone", campus.phoneE164())
                .param("email", campus.email())
                .param("timezone", campus.timezone())
                .param("openedOn", campus.openedOn())
                .update();
    }

    public void update(Campus campus) {
        int updated = jdbc.sql("""
                UPDATE school.campus
                   SET name = :name,
                       address_line1 = :line1, address_line2 = :line2, city = :city,
                       region = :region, postal_code = :postalCode, country_code = :countryCode,
                       phone_e164 = :phone, email = :email, timezone = :timezone,
                       opened_on = :openedOn
                 WHERE tenant_id = :tenantId AND id = :id AND version = :version
                """)
                .param("name", campus.name())
                .param("line1", campus.address().line1())
                .param("line2", campus.address().line2())
                .param("city", campus.address().city())
                .param("region", campus.address().region())
                .param("postalCode", campus.address().postalCode())
                .param("countryCode", campus.address().countryCode())
                .param("phone", campus.phoneE164())
                .param("email", campus.email())
                .param("timezone", campus.timezone())
                .param("openedOn", campus.openedOn())
                .param("tenantId", campus.tenantId())
                .param("id", campus.id())
                .param("version", campus.version())
                .update();

        if (updated == 0) {
            throw new OptimisticLockingFailureException(
                    "Campus " + campus.id() + " was changed by someone else, or no longer exists");
        }
    }

    public void updateStatus(UUID tenantId, UUID id, CampusStatus status, long version) {
        int updated = jdbc.sql("""
                UPDATE school.campus
                   SET status = :status,
                       closed_on = CASE WHEN :status = 'CLOSED' THEN current_date ELSE NULL END
                 WHERE tenant_id = :tenantId AND id = :id AND version = :version
                """)
                .param("status", status.name())
                .param("tenantId", tenantId)
                .param("id", id)
                .param("version", version)
                .update();

        if (updated == 0) {
            throw new OptimisticLockingFailureException(
                    "Campus " + id + " was changed by someone else, or no longer exists");
        }
    }

    /**
     * Moves the "main campus" designation.
     *
     * <p>Clears first, then sets. The partial unique index guarantees at most one main campus
     * per tenant regardless; this ordering is what lets the common case succeed instead of
     * colliding with that index.
     */
    public void setMain(UUID tenantId, UUID id) {
        jdbc.sql("""
                UPDATE school.campus SET is_main = false
                 WHERE tenant_id = :tenantId AND is_main AND id <> :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .update();

        jdbc.sql("""
                UPDATE school.campus SET is_main = true
                 WHERE tenant_id = :tenantId AND id = :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .update();
    }

    private static Campus mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new Campus(
                rs.getObject("id", UUID.class),
                rs.getObject("tenant_id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getBoolean("is_main"),
                CampusStatus.of(rs.getString("status")),
                new Address(
                        rs.getString("address_line1"),
                        rs.getString("address_line2"),
                        rs.getString("city"),
                        rs.getString("region"),
                        rs.getString("postal_code"),
                        rs.getString("country_code")),
                rs.getString("phone_e164"),
                rs.getString("email"),
                rs.getString("timezone"),
                rs.getObject("opened_on", LocalDate.class),
                rs.getObject("closed_on", LocalDate.class),
                rs.getLong("version"));
    }
}
