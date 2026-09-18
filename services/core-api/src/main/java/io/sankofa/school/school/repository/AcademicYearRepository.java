package io.sankofa.school.school.repository;

import io.sankofa.school.school.domain.AcademicYear;
import io.sankofa.school.school.domain.CalendarStatus;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence for {@link AcademicYear}.
 *
 * <p>Every statement names its tenant explicitly. Row Level Security would catch a missing
 * predicate anyway, but writing it out means a reviewer can see the scoping at the call site
 * instead of having to trust that a policy exists — which is the whole point of defence in depth
 * (AGENTS.md §5).
 */
@Repository
public class AcademicYearRepository {

    private static final String COLUMNS = """
            id, tenant_id, code, name, starts_on, ends_on, status, is_current,
            closed_at, closed_by, version
            """;

    private static final RowMapper<AcademicYear> MAPPER = AcademicYearRepository::mapRow;

    private final JdbcClient jdbc;

    public AcademicYearRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<AcademicYear> findAll(UUID tenantId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.academic_year
                 WHERE tenant_id = :tenantId
                 ORDER BY starts_on DESC
                """)
                .param("tenantId", tenantId)
                .query(MAPPER)
                .list();
    }

    public Optional<AcademicYear> findById(UUID tenantId, UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.academic_year
                 WHERE tenant_id = :tenantId AND id = :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .query(MAPPER)
                .optional();
    }

    public Optional<AcademicYear> findCurrent(UUID tenantId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.academic_year
                 WHERE tenant_id = :tenantId AND is_current
                """)
                .param("tenantId", tenantId)
                .query(MAPPER)
                .optional();
    }

    /**
     * The year covering a date, if any.
     *
     * <p>Used when back-dating an attendance correction or an invoice: the year is derived from
     * the date it belongs to, not from whichever year happens to be current today.
     */
    public Optional<AcademicYear> findCovering(UUID tenantId, LocalDate date) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.academic_year
                 WHERE tenant_id = :tenantId
                   AND :date BETWEEN starts_on AND ends_on
                """)
                .param("tenantId", tenantId)
                .param("date", date)
                .query(MAPPER)
                .optional();
    }

    public void insert(AcademicYear year) {
        jdbc.sql("""
                INSERT INTO school.academic_year
                    (id, tenant_id, code, name, starts_on, ends_on, status, is_current)
                VALUES (:id, :tenantId, :code, :name, :startsOn, :endsOn, :status, :isCurrent)
                """)
                .param("id", year.id())
                .param("tenantId", year.tenantId())
                .param("code", year.code())
                .param("name", year.name())
                .param("startsOn", year.startsOn())
                .param("endsOn", year.endsOn())
                .param("status", year.status().name())
                .param("isCurrent", year.current())
                .update();
    }

    /**
     * Updates the editable fields.
     *
     * <p>The {@code version} predicate is the optimistic lock: if another administrator saved
     * between this caller's read and write, no row matches and the caller is told to reload
     * rather than silently overwriting a change they never saw.
     */
    public void update(AcademicYear year) {
        int updated = jdbc.sql("""
                UPDATE school.academic_year
                   SET code = :code, name = :name, starts_on = :startsOn, ends_on = :endsOn
                 WHERE tenant_id = :tenantId AND id = :id AND version = :version
                """)
                .param("code", year.code())
                .param("name", year.name())
                .param("startsOn", year.startsOn())
                .param("endsOn", year.endsOn())
                .param("tenantId", year.tenantId())
                .param("id", year.id())
                .param("version", year.version())
                .update();

        requireUpdated(updated, year.id());
    }

    public void updateStatus(UUID tenantId, UUID id, CalendarStatus status, long version,
                             UUID closedBy) {
        int updated = jdbc.sql("""
                UPDATE school.academic_year
                   SET status = :status,
                       closed_at = CASE WHEN :status = 'CLOSED' THEN now() ELSE NULL END,
                       closed_by = CASE WHEN :status = 'CLOSED' THEN cast(:closedBy AS uuid) ELSE NULL END,
                       is_current = CASE WHEN :status = 'CLOSED' THEN false ELSE is_current END
                 WHERE tenant_id = :tenantId AND id = :id AND version = :version
                """)
                .param("status", status.name())
                .param("closedBy", closedBy)
                .param("tenantId", tenantId)
                .param("id", id)
                .param("version", version)
                .update();

        requireUpdated(updated, id);
    }

    /**
     * Makes one year current, clearing any other.
     *
     * <p>Two statements in one transaction. The database's partial unique index guarantees at
     * most one current year per tenant regardless — this ordering is what makes the common case
     * succeed instead of colliding with that index.
     */
    public void makeCurrent(UUID tenantId, UUID id) {
        jdbc.sql("""
                UPDATE school.academic_year
                   SET is_current = false
                 WHERE tenant_id = :tenantId AND is_current AND id <> :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .update();

        jdbc.sql("""
                UPDATE school.academic_year
                   SET is_current = true
                 WHERE tenant_id = :tenantId AND id = :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .update();
    }

    public boolean codeExists(UUID tenantId, String code) {
        return jdbc.sql("""
                SELECT count(*) FROM school.academic_year
                 WHERE tenant_id = :tenantId AND lower(code) = lower(:code)
                """)
                .param("tenantId", tenantId)
                .param("code", code)
                .query(Long.class)
                .single() > 0;
    }

    /** Whether any term of this year is not yet closed — a year cannot close before its terms. */
    public boolean hasOpenTerms(UUID tenantId, UUID yearId) {
        return jdbc.sql("""
                SELECT count(*) FROM school.term
                 WHERE tenant_id = :tenantId
                   AND academic_year_id = :yearId
                   AND status <> 'CLOSED'
                """)
                .param("tenantId", tenantId)
                .param("yearId", yearId)
                .query(Long.class)
                .single() > 0;
    }

    private static void requireUpdated(int updated, UUID id) {
        if (updated == 0) {
            throw new OptimisticLockingFailureException(
                    "Academic year " + id + " was changed by someone else, or no longer exists");
        }
    }

    private static AcademicYear mapRow(ResultSet rs, int rowNum) throws SQLException {
        OffsetDateTime closedAt = rs.getObject("closed_at", OffsetDateTime.class);
        return new AcademicYear(
                rs.getObject("id", UUID.class),
                rs.getObject("tenant_id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getObject("starts_on", LocalDate.class),
                rs.getObject("ends_on", LocalDate.class),
                CalendarStatus.of(rs.getString("status")),
                rs.getBoolean("is_current"),
                closedAt == null ? null : closedAt.toInstant(),
                rs.getObject("closed_by", UUID.class),
                rs.getLong("version"));
    }
}
