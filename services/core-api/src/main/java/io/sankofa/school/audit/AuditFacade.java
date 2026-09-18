package io.sankofa.school.audit;

import java.util.Map;
import java.util.UUID;

/**
 * The published contract other modules use to record what happened.
 *
 * <p>Deliberately in the module's root package rather than in {@code audit.application}: it is
 * the one type other modules are allowed to depend on. The implementation, its repository and
 * its internals stay private to the module, which is what stops "record an audit entry" from
 * turning into "reach into the audit tables" (see {@code ARCHITECTURE.md} §3).
 *
 * <p>Writing an audit entry is part of the same transaction as the thing being audited. That is
 * intentional: an action that commits without its audit entry, or an audit entry describing an
 * action that rolled back, are both worse than either failing outright.
 */
public interface AuditFacade {

    /** Records an action. The tenant, actor and correlation id come from the bound context. */
    void record(AuditRecord record);

    /**
     * A single auditable action.
     *
     * @param action       {@code MODULE_NOUN_VERB}, past tense: {@code ACADEMIC_YEAR_ACTIVATED}
     * @param resourceType the kind of thing acted on, e.g. {@code AcademicYear}
     * @param resourceId   its identifier, may be null for actions with no single subject
     * @param resourceRef  the human-facing reference where one exists, so an auditor can search
     *                     for what is actually in front of them rather than a uuid
     * @param reason       required for high-risk actions (§188); null otherwise
     * @param before       prior field values worth reconstructing, or null
     * @param after        new field values worth reconstructing, or null
     */
    record AuditRecord(
            String action,
            String resourceType,
            UUID resourceId,
            String resourceRef,
            String reason,
            Map<String, Object> before,
            Map<String, Object> after) {

        public static AuditRecord of(String action, String resourceType, UUID resourceId) {
            return new AuditRecord(action, resourceType, resourceId, null, null, null, null);
        }

        public static AuditRecord of(String action, String resourceType, UUID resourceId,
                                     String resourceRef) {
            return new AuditRecord(action, resourceType, resourceId, resourceRef, null, null, null);
        }

        public AuditRecord withReason(String reason) {
            return new AuditRecord(action, resourceType, resourceId, resourceRef, reason,
                    before, after);
        }

        public AuditRecord withChange(Map<String, Object> before, Map<String, Object> after) {
            return new AuditRecord(action, resourceType, resourceId, resourceRef, reason,
                    before, after);
        }
    }
}
