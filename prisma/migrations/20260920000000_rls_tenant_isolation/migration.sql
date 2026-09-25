-- =====================================================================================
-- RLS-based tenant isolation
--
-- This migration implements proper row-level security for tenant isolation, addressing
-- the highest-priority weakness in IMPLEMENTATION_STATUS.md.
--
-- The approach:
-- 1. Create per-tenant policies on all tenant-owned tables
-- 2. Handle nullable-tenant tables (audit_log, security_event) 
-- 3. Handle read-shared-but-not-writable tables (role)
-- 4. Set up session variable (app.tenant_id) for policy use
-- 5. Create a dedicated application role without BYPASSRLS
--
-- IMPORTANT: The role must be created AFTER the policies, or queries will return nothing.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Enable RLS on all tenant-owned tables (should already be enabled from previous migration)
-- -------------------------------------------------------------------------------------

-- -------------------------------------------------------------------------------------
-- 2. Create the application role without BYPASSRLS
-- -------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sankofa_app') THEN
    -- Provision login access and its password separately through the deployment secret
    -- manager. A migration must never install a reusable or publicly visible password.
    CREATE ROLE sankofa_app WITH NOLOGIN NOINHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    
    -- Grant usage on schema
    GRANT USAGE ON SCHEMA public TO sankofa_app;
    
    -- Grant basic privileges on all tables
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sankofa_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sankofa_app;
    
    -- Grant execute on all functions
    GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO sankofa_app;
    
    -- Ensure future objects get these grants
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sankofa_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sankofa_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON ROUTINES TO sankofa_app;
    
    RAISE NOTICE 'Created sankofa_app role for RLS-based tenant isolation';
  ELSE
    RAISE NOTICE 'sankofa_app role already exists';
  END IF;
END
$$;

-- -------------------------------------------------------------------------------------
-- 3. Drop existing policies if any (for idempotency)
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_select ON campus;
DROP POLICY IF EXISTS tenant_isolation_insert ON campus;
DROP POLICY IF EXISTS tenant_isolation_update ON campus;
DROP POLICY IF EXISTS tenant_isolation_delete ON campus;

DROP POLICY IF EXISTS tenant_isolation_select ON academic_year;
DROP POLICY IF EXISTS tenant_isolation_insert ON academic_year;
DROP POLICY IF EXISTS tenant_isolation_update ON academic_year;
DROP POLICY IF EXISTS tenant_isolation_delete ON academic_year;

DROP POLICY IF EXISTS tenant_isolation_select ON term;
DROP POLICY IF EXISTS tenant_isolation_insert ON term;
DROP POLICY IF EXISTS tenant_isolation_update ON term;
DROP POLICY IF EXISTS tenant_isolation_delete ON term;

DROP POLICY IF EXISTS tenant_isolation_select ON membership;
DROP POLICY IF EXISTS tenant_isolation_insert ON membership;
DROP POLICY IF EXISTS tenant_isolation_update ON membership;
DROP POLICY IF EXISTS tenant_isolation_delete ON membership;

DROP POLICY IF EXISTS tenant_isolation_select ON reference_sequence;
DROP POLICY IF EXISTS tenant_isolation_insert ON reference_sequence;
DROP POLICY IF EXISTS tenant_isolation_update ON reference_sequence;
DROP POLICY IF EXISTS tenant_isolation_delete ON reference_sequence;

DROP POLICY IF EXISTS tenant_isolation_select ON branding;
DROP POLICY IF EXISTS tenant_isolation_insert ON branding;
DROP POLICY IF EXISTS tenant_isolation_update ON branding;
DROP POLICY IF EXISTS tenant_isolation_delete ON branding;

-- Drop policies for nullable-tenant tables
DROP POLICY IF EXISTS audit_log_select ON audit_log;
DROP POLICY IF EXISTS audit_log_insert ON audit_log;

DROP POLICY IF EXISTS security_event_select ON security_event;
DROP POLICY IF EXISTS security_event_insert ON security_event;

-- Drop policies for shared-read tables
DROP POLICY IF EXISTS role_select ON role;
DROP POLICY IF EXISTS role_insert ON role;
DROP POLICY IF EXISTS role_update ON role;
DROP POLICY IF EXISTS role_delete ON role;

-- -------------------------------------------------------------------------------------
-- 4. Create per-tenant policies for tenant-owned tables
-- These policies use the app.tenant_id session variable
-- -------------------------------------------------------------------------------------

-- Campus policies
CREATE POLICY tenant_isolation_select ON campus
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_insert ON campus
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON campus
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON campus
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- Academic Year policies
CREATE POLICY tenant_isolation_select ON academic_year
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_insert ON academic_year
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON academic_year
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON academic_year
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- Term policies
CREATE POLICY tenant_isolation_select ON term
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_insert ON term
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON term
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON term
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- Membership policies
CREATE POLICY tenant_isolation_select ON membership
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_insert ON membership
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON membership
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON membership
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- Reference Sequence policies
CREATE POLICY tenant_isolation_select ON reference_sequence
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_insert ON reference_sequence
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON reference_sequence
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON reference_sequence
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- Branding policies (tenant-keyed table)
CREATE POLICY tenant_isolation_select ON branding
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_insert ON branding
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON branding
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON branding
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- -------------------------------------------------------------------------------------
-- 5. Create policies for nullable-tenant tables
-- These tables may have platform rows ("tenantId" IS NULL) that should be readable
-- -------------------------------------------------------------------------------------

-- Audit Log policies
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::uuid);

-- Security Event policies
CREATE POLICY security_event_select ON security_event
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY security_event_insert ON security_event
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::uuid);

-- -------------------------------------------------------------------------------------
-- 6. Create policies for shared-read tables (role)
-- NULL tenant_id means "every school may use this template"
-- Schools can read both system roles (NULL) and their own roles
-- Schools can only write their own roles
-- -------------------------------------------------------------------------------------

CREATE POLICY role_select ON role
  FOR SELECT
  TO sankofa_app
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY role_insert ON role
  FOR INSERT
  TO sankofa_app
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY role_update ON role
  FOR UPDATE
  TO sankofa_app
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY role_delete ON role
  FOR DELETE
  TO sankofa_app
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);

-- -------------------------------------------------------------------------------------
-- 7. Create platform admin policies (optional, for future use)
-- These would allow platform admins to see all data
-- Currently not implemented as platform admin UI doesn't exist
-- -------------------------------------------------------------------------------------

-- -------------------------------------------------------------------------------------
-- IMPORTANT NOTES:
--
-- 1. To use these policies, the application must set the session variable:
--    SET LOCAL app.tenant_id = '<tenant-uuid>';
--    This should be done at the start of every transaction.
--
-- 2. To switch the application to use the sankofa_app role:
--    - Update DATABASE_URL to use sankofa_app instead of postgres
--    - Set a secure password for the sankofa_app role
--    - Update the connection string in environment variables
--
-- 3. The current tenant-scope.ts client extension still needs to be maintained
--    as a defense-in-depth measure, but RLS now provides database-level enforcement.
--
-- 4. Policies fail closed when app.tenant_id is not set (returns no rows)
-- -------------------------------------------------------------------------------------
