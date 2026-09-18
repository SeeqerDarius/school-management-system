-- =====================================================================================
-- V0009 — Audit log
--
-- The record of who did what, to which record, when, and why (§73).
--
-- DESIGN RULES
-- ------------
-- 1. Append-only, enforced by trigger AND by privilege. The application role holds INSERT and
--    SELECT; UPDATE and DELETE are revoked outright. An audit trail the application can edit
--    is not an audit trail — it is a log that happens to be in a database.
--
-- 2. A reason is REQUIRED for high-risk actions (§188). The reason is not decoration: six
--    months later, "who reversed this journal" is far less useful than "who reversed it, and
--    what they said at the time".
--
-- 3. before_value / after_value are jsonb and deliberately optional. They are populated for
--    field-level changes worth reconstructing (a grade, a salary, a permission grant) and left
--    null for ordinary lifecycle transitions where the action name already says everything.
--
-- 4. Nothing sensitive is ever placed in this table by convention: no password, no token, no
--    plaintext message, no full payment instrument. See the deny-list in docs/SECURITY.md.
--    The schema cannot enforce that; review must.
-- =====================================================================================

CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA audit IS
    'Append-only record of significant actions. Readable by the tenant it concerns.';

CREATE TABLE audit.audit_log (
    id                uuid        PRIMARY KEY,
    -- Nullable: platform-scope actions (provisioning a tenant) belong to no tenant.
    tenant_id         uuid        REFERENCES platform.tenant(id) ON DELETE CASCADE,
    actor_user_id     uuid        REFERENCES identity.app_user(id) ON DELETE SET NULL,
    actor_membership_id uuid      REFERENCES identity.membership(id) ON DELETE SET NULL,

    -- MODULE_NOUN_VERB, past tense: ACADEMIC_YEAR_ACTIVATED, GRADE_AMENDED, JOURNAL_REVERSED.
    action            text        NOT NULL,
    resource_type     text        NOT NULL,
    resource_id       uuid,
    -- The human-facing reference where one exists (STU-2026-000123), so an auditor can search
    -- for what they actually have in front of them rather than an internal uuid.
    resource_ref      text,

    occurred_at       timestamptz NOT NULL DEFAULT now(),
    reason            text,
    before_value      jsonb,
    after_value       jsonb,

    ip_address        inet,
    user_agent        text,
    correlation_id    text,
    -- Set when platform support was acting inside the tenant under a time-boxed grant (§74),
    -- so "support did this" is never indistinguishable from "the school did this".
    support_grant_id  uuid        REFERENCES identity.support_access_grant(id) ON DELETE SET NULL,

    CONSTRAINT ck_audit_action CHECK (action ~ '^[A-Z][A-Z0-9_]{2,79}$'),
    -- A reason, when given, must say something. Blank strings defeat the purpose.
    CONSTRAINT ck_audit_reason CHECK (reason IS NULL OR length(btrim(reason)) >= 3)
);

-- The three ways an audit log is actually read: "what happened in my school recently",
-- "what did this person do", and "what happened to this record".
CREATE INDEX ix_audit_tenant_time ON audit.audit_log (tenant_id, occurred_at DESC);
CREATE INDEX ix_audit_actor ON audit.audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX ix_audit_resource ON audit.audit_log (resource_type, resource_id, occurred_at DESC);
CREATE INDEX ix_audit_action ON audit.audit_log (action, occurred_at DESC);
-- Support activity is reviewed as a set, and it is a small fraction of rows.
CREATE INDEX ix_audit_support ON audit.audit_log (support_grant_id, occurred_at DESC)
    WHERE support_grant_id IS NOT NULL;

CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log FORCE  ROW LEVEL SECURITY;

-- A school reads its own history. Platform-scope rows have a NULL tenant_id and so match no
-- tenant predicate, which is the intended behaviour rather than an accident of NULL handling.
CREATE POLICY audit_read ON audit.audit_log
    FOR SELECT
    USING (platform.is_platform_scope()
           OR tenant_id = platform.current_tenant_id_or_null());

CREATE POLICY audit_write ON audit.audit_log
    FOR INSERT
    WITH CHECK (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id());

COMMENT ON TABLE audit.audit_log IS
    'Append-only. The application role may INSERT and SELECT; UPDATE and DELETE are revoked, '
    'so a compromised application cannot rewrite what it did.';

-- -------------------------------------------------------------------------------------
-- Privileges
--
-- The GRANT is narrower than the schema default on purpose: no UPDATE, no DELETE, ever.
-- The trigger above would refuse them anyway; revoking the privilege means the attempt never
-- reaches the trigger, and makes the intent obvious to anyone reading \dp.
-- -------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA audit TO "${appRole}";
GRANT SELECT, INSERT ON audit.audit_log TO "${appRole}";

ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT SELECT, INSERT ON TABLES TO "${appRole}";
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT EXECUTE ON FUNCTIONS TO "${appRole}";
