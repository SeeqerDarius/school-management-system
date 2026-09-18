package io.sankofa.school.audit.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.sankofa.school.audit.AuditFacade;
import io.sankofa.school.platform.id.Ids;
import io.sankofa.school.platform.context.CorrelationId;
import io.sankofa.school.tenancy.TenantContext;
import io.sankofa.school.tenancy.TenantContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * Writes the audit log.
 *
 * <p>{@link Propagation#MANDATORY} is the important detail. It means this method <em>cannot</em>
 * be called outside an existing transaction — so an audit entry is always written in the same
 * transaction as the change it describes, and the two commit or roll back together. An audit
 * trail that can disagree with the data it describes is not evidence of anything.
 *
 * <p>The failure mode this prevents is subtle: with {@code REQUIRES_NEW} the audit entry would
 * survive a rolled-back action, producing a log that says a grade was amended when it was not.
 */
@Service
public class AuditService implements AuditFacade {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public AuditService(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(AuditRecord record) {
        TenantContext context = TenantContextHolder.require();

        jdbc.sql("""
                INSERT INTO audit.audit_log
                    (id, tenant_id, actor_user_id, actor_membership_id, action,
                     resource_type, resource_id, resource_ref, reason,
                     before_value, after_value, correlation_id, support_grant_id)
                VALUES (:id, :tenantId, :actorUserId, :membershipId, :action,
                        :resourceType, :resourceId, :resourceRef, :reason,
                        cast(:before AS jsonb), cast(:after AS jsonb),
                        :correlationId, :supportGrantId)
                """)
                .param("id", Ids.newId())
                .param("tenantId", context.tenantId())
                .param("actorUserId", context.userId())
                .param("membershipId", context.membershipId())
                .param("action", record.action())
                .param("resourceType", record.resourceType())
                .param("resourceId", record.resourceId())
                .param("resourceRef", record.resourceRef())
                .param("reason", record.reason())
                .param("before", toJson(record.before()))
                .param("after", toJson(record.after()))
                .param("correlationId", CorrelationId.current())
                // Carried so that "support did this" is never indistinguishable from
                // "the school did this" (§74).
                .param("supportGrantId", context.supportGrantId())
                .update();
    }

    /**
     * Serialises a change map.
     *
     * <p>Returns null rather than throwing on a value Jackson cannot handle. Losing the detail
     * of <em>what</em> changed is regrettable; losing the record that something changed — or
     * failing the user's action because of a serialisation quirk — is worse. The failure is
     * logged at WARN so it is visible rather than silent.
     */
    private String toJson(Map<String, Object> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(values);
        } catch (JsonProcessingException e) {
            log.warn("Could not serialise audit change detail; recording the entry without it", e);
            return null;
        }
    }
}
