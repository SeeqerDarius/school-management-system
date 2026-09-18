-- =====================================================================================
-- V0004 — Row Level Security for the operational tables that V0001/V0002 left uncovered
--
-- WHY THIS IS A NEW MIGRATION RATHER THAN AN EDIT
-- -----------------------------------------------
-- identity.security_event and platform.job_execution were created with a tenant_id column
-- but without an RLS policy. That gap was found by TenantIsolationIT's catalogue sweep,
-- which walks pg_class looking for any table with a tenant_id column and no forced policy.
--
-- The correct fix is a new migration, not an edit to V0001/V0002. An applied migration is
-- history: editing one breaks the checksum for every environment that already ran it, and
-- "it is only a development database" is how a habit starts (AGENTS.md §8).
--
-- BOTH COLUMNS ARE NULLABLE, DELIBERATELY
-- ---------------------------------------
-- A platform-wide job (outbox dispatch across every tenant) and a platform-wide security
-- event (a support engineer signing in) genuinely have no tenant. The policies below use
-- `tenant_id = platform.current_tenant_id()`, and SQL three-valued logic means a NULL
-- tenant_id never matches — so a school cannot read platform-wide rows. That is the intended
-- behaviour, not an accident of NULL handling, and it is asserted by a test.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- identity.security_event
--
-- A school can read its own security history — failed sign-ins against its accounts, MFA
-- changes, privileged grants — because that is operationally theirs to review (§179).
-- Rows are inserted by the platform and are already immutable via trg_security_event_immutable.
-- -------------------------------------------------------------------------------------

ALTER TABLE identity.security_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.security_event FORCE  ROW LEVEL SECURITY;

CREATE POLICY security_event_read ON identity.security_event
    FOR SELECT
    USING (platform.is_platform_scope()
           OR tenant_id = platform.current_tenant_id()
           OR user_id = platform.current_user_id());

-- Writes come from the authentication and authorization paths, always within a bound
-- context. There is no path by which a tenant writes an event attributed to another.
CREATE POLICY security_event_write ON identity.security_event
    FOR INSERT
    WITH CHECK (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id()
                OR (tenant_id IS NULL AND user_id = platform.current_user_id()));

COMMENT ON POLICY security_event_read ON identity.security_event IS
    'A principal sees events for their own account, and a school sees events for its tenant. '
    'Platform-wide rows have a NULL tenant_id and therefore match no tenant predicate.';

-- -------------------------------------------------------------------------------------
-- platform.job_execution
--
-- Job history is operational data. A school may see the jobs that ran for it — an overdue-fee
-- sweep, a report generation batch — which is what makes a failed job visible rather than
-- silent (Invariant I-8). Platform-wide job rows stay with the platform.
-- -------------------------------------------------------------------------------------

ALTER TABLE platform.job_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.job_execution FORCE  ROW LEVEL SECURITY;

CREATE POLICY job_execution_read ON platform.job_execution
    FOR SELECT
    USING (platform.is_platform_scope() OR tenant_id = platform.current_tenant_id());

-- The scheduler runs as ${migrateRole}, which holds BYPASSRLS, so it writes rows for any
-- tenant. Application code may only record a job against its own tenant.
CREATE POLICY job_execution_write ON platform.job_execution
    FOR ALL
    USING      (tenant_id = platform.current_tenant_id())
    WITH CHECK (tenant_id = platform.current_tenant_id());

COMMENT ON POLICY job_execution_read ON platform.job_execution IS
    'Schools see their own job history so a failed overnight job is visible to them, not only '
    'to the platform operator.';
