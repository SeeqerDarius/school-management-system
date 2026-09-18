package io.sankofa.school.school.repository;

import io.sankofa.school.school.domain.CalendarStatus;
import io.sankofa.school.school.domain.Term;
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

/** Persistence for {@link Term}. Every statement carries its tenant predicate explicitly. */
@Repository
public class TermRepository {

    private static final String COLUMNS = """
            id, tenant_id, academic_year_id, sequence, code, name, starts_on, ends_on,
            status, is_current, reports_due_on, closed_at, closed_by, version
            """;

    private static final RowMapper<Term> MAPPER = TermRepository::mapRow;

    private final JdbcClient jdbc;

    public TermRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<Term> findByYear(UUID tenantId, UUID academicYearId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.term
                 WHERE tenant_id = :tenantId AND academic_year_id = :yearId
                 ORDER BY sequence
                """)
                .param("tenantId", tenantId)
                .param("yearId", academicYearId)
                .query(MAPPER)
                .list();
    }

    public Optional<Term> findById(UUID tenantId, UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.term
                 WHERE tenant_id = :tenantId AND id = :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .query(MAPPER)
                .optional();
    }

    public Optional<Term> findCurrent(UUID tenantId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                  FROM school.term
                 WHERE tenant_id = :tenantId AND is_current
                """)
                .param("tenantId", tenantId)
                .query(MAPPER)
                .optional();
    }

    public void insert(Term term) {
        jdbc.sql("""
                INSERT INTO school.term
                    (id, tenant_id, academic_year_id, sequence, code, name,
                     starts_on, ends_on, status, is_current, reports_due_on)
                VALUES (:id, :tenantId, :yearId, :sequence, :code, :name,
                        :startsOn, :endsOn, :status, :isCurrent, :reportsDueOn)
                """)
                .param("id", term.id())
                .param("tenantId", term.tenantId())
                .param("yearId", term.academicYearId())
                .param("sequence", term.sequence())
                .param("code", term.code())
                .param("name", term.name())
                .param("startsOn", term.startsOn())
                .param("endsOn", term.endsOn())
                .param("status", term.status().name())
                .param("isCurrent", term.current())
                .param("reportsDueOn", term.reportsDueOn())
                .update();
    }

    public void update(Term term) {
        int updated = jdbc.sql("""
                UPDATE school.term
                   SET code = :code, name = :name, starts_on = :startsOn, ends_on = :endsOn,
                       reports_due_on = :reportsDueOn
                 WHERE tenant_id = :tenantId AND id = :id AND version = :version
                """)
                .param("code", term.code())
                .param("name", term.name())
                .param("startsOn", term.startsOn())
                .param("endsOn", term.endsOn())
                .param("reportsDueOn", term.reportsDueOn())
                .param("tenantId", term.tenantId())
                .param("id", term.id())
                .param("version", term.version())
                .update();

        if (updated == 0) {
            throw new OptimisticLockingFailureException(
                    "Term " + term.id() + " was changed by someone else, or no longer exists");
        }
    }

    public void updateStatus(UUID tenantId, UUID id, CalendarStatus status, long version,
                             UUID closedBy) {
        int updated = jdbc.sql("""
                UPDATE school.term
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

        if (updated == 0) {
            throw new OptimisticLockingFailureException(
                    "Term " + id + " was changed by someone else, or no longer exists");
        }
    }

    public void makeCurrent(UUID tenantId, UUID id) {
        jdbc.sql("""
                UPDATE school.term SET is_current = false
                 WHERE tenant_id = :tenantId AND is_current AND id <> :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .update();

        jdbc.sql("""
                UPDATE school.term SET is_current = true
                 WHERE tenant_id = :tenantId AND id = :id
                """)
                .param("tenantId", tenantId)
                .param("id", id)
                .update();
    }

    /** The next free sequence number within a year, so callers need not compute it. */
    public int nextSequence(UUID tenantId, UUID academicYearId) {
        return jdbc.sql("""
                SELECT coalesce(max(sequence), 0) + 1
                  FROM school.term
                 WHERE tenant_id = :tenantId AND academic_year_id = :yearId
                """)
                .param("tenantId", tenantId)
                .param("yearId", academicYearId)
                .query(Integer.class)
                .single();
    }

    private static Term mapRow(ResultSet rs, int rowNum) throws SQLException {
        OffsetDateTime closedAt = rs.getObject("closed_at", OffsetDateTime.class);
        return new Term(
                rs.getObject("id", UUID.class),
                rs.getObject("tenant_id", UUID.class),
                rs.getObject("academic_year_id", UUID.class),
                rs.getInt("sequence"),
                rs.getString("code"),
                rs.getString("name"),
                rs.getObject("starts_on", LocalDate.class),
                rs.getObject("ends_on", LocalDate.class),
                CalendarStatus.of(rs.getString("status")),
                rs.getBoolean("is_current"),
                rs.getObject("reports_due_on", LocalDate.class),
                closedAt == null ? null : closedAt.toInstant(),
                rs.getObject("closed_by", UUID.class),
                rs.getLong("version"));
    }
}
