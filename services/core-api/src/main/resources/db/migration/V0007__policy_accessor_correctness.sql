-- =====================================================================================
-- V0007 — Use the non-raising tenant accessor in policy USING clauses
--
-- THE BUG
-- -------
-- A `FOR ALL` policy's USING clause is evaluated on SELECT as well as on UPDATE and DELETE.
-- Permissive policies are OR'd together, but PostgreSQL still *evaluates* each one — so a
-- SELECT against identity.membership evaluated both `membership_self_read` (harmless) and
-- `membership_write`, whose USING called platform.current_tenant_id().
--
-- That function raises by design when no tenant is bound. On a normal request a tenant is
-- always bound, so this never showed up. But the sign-in path deliberately runs before any
-- tenant exists — that is its entire purpose — and there it turned every membership lookup
-- into SQLSTATE 42501, surfacing as an opaque 500 with no indication of which statement was
-- responsible.
--
-- THE FIX, AND WHERE IT DOES NOT APPLY
-- ------------------------------------
-- USING clauses on tables that are legitimately read during bootstrap now use
-- platform.current_tenant_id_or_null(). With no tenant bound it returns NULL, and
-- `tenant_id = NULL` is never true, so the query still returns nothing. Fail closed either
-- way — the difference is a quiet empty result instead of an exception.
--
-- WITH CHECK clauses keep the raising accessor. A write with no tenant is always a defect,
-- and there is no bootstrap flow that legitimately inserts tenant-owned data before a tenant
-- is known. Loud is correct there.
--
-- platform.reference_sequence and platform.outbox keep the raising accessor in BOTH clauses.
-- Nothing reads them before a tenant exists, so the loud failure remains a useful tripwire —
-- and TenantIsolationIT.unscopedQueryIsRejected asserts exactly that behaviour on
-- reference_sequence, which is what makes "fail closed" a tested property rather than a claim.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- identity.membership — read during sign-in, before any tenant is chosen
-- -------------------------------------------------------------------------------------

DROP POLICY IF EXISTS membership_write ON identity.membership;

CREATE POLICY membership_write ON identity.membership
    FOR ALL
    USING      (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id_or_null())
    -- A membership can only ever be written into the tenant currently bound.
    WITH CHECK (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- identity.role — read while resolving permissions for a newly bound membership
-- -------------------------------------------------------------------------------------

DROP POLICY IF EXISTS role_write ON identity.role;

CREATE POLICY role_write ON identity.role
    FOR ALL
    USING      (platform.is_platform_scope()
                OR (tenant_id IS NOT NULL
                    AND tenant_id = platform.current_tenant_id_or_null()))
    WITH CHECK (platform.is_platform_scope()
                OR (tenant_id IS NOT NULL
                    AND tenant_id = platform.current_tenant_id()));

-- -------------------------------------------------------------------------------------
-- identity.support_access_grant — a school reads its own support history
-- -------------------------------------------------------------------------------------

DROP POLICY IF EXISTS support_grant_visibility ON identity.support_access_grant;

CREATE POLICY support_grant_visibility ON identity.support_access_grant
    FOR ALL
    USING      (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id_or_null())
    -- Only the platform grants support access; a tenant can read its history, never write it.
    WITH CHECK (platform.is_platform_scope());

-- -------------------------------------------------------------------------------------
-- platform.tenant_feature_flag — consulted during routing, potentially before tenant binding
-- -------------------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_isolation ON platform.tenant_feature_flag;

CREATE POLICY tenant_isolation ON platform.tenant_feature_flag
    FOR ALL
    USING      (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- platform.job_execution — its read policy coexists with a FOR ALL write policy
-- -------------------------------------------------------------------------------------

DROP POLICY IF EXISTS job_execution_write ON platform.job_execution;

CREATE POLICY job_execution_write ON platform.job_execution
    FOR ALL
    USING      (tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (tenant_id = platform.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- platform.tenant_usage — same shape, same correction
-- -------------------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_usage_access ON platform.tenant_usage;

CREATE POLICY tenant_usage_access ON platform.tenant_usage
    FOR ALL
    USING      (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id_or_null())
    WITH CHECK (platform.is_platform_scope()
                OR tenant_id = platform.current_tenant_id_or_null());
