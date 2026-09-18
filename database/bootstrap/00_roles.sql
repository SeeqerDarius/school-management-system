-- =====================================================================================
-- Cluster bootstrap — database roles
--
-- RUN THIS ONCE PER ENVIRONMENT, BEFORE THE FIRST MIGRATION, AS A SUPERUSER.
--
-- It is deliberately NOT a Flyway migration. Roles are cluster-level objects, they usually
-- already exist by the time the application deploys, and creating them needs privileges the
-- migration role itself does not have. Putting them in the migration chain would make every
-- fresh environment fail on V0001 for a reason that has nothing to do with the schema.
--
--   psql "$SUPERUSER_URL" -v app_password="'...'" -v migrate_password="'...'" \
--        -f database/bootstrap/00_roles.sql
--
-- =====================================================================================
--
-- WHY TWO ROLES
-- -------------
-- This is the structural basis of tenant isolation, not an operational nicety.
--
--   sankofa_migrate  owns the schemas, holds BYPASSRLS. Runs Flyway, and runs the system
--                    jobs that legitimately span tenants (the outbox poller, the usage
--                    recompute). It is NOT the credential the application serves traffic on.
--
--   sankofa_app      the runtime identity. Owns nothing, holds no BYPASSRLS, is not a
--                    superuser. Row Level Security applies to it on every query.
--
-- A PostgreSQL superuser — and any role with BYPASSRLS — ignores row level security
-- unconditionally. If the application connected as either, every policy in the schema would
-- be inert, every cross-tenant test would pass vacuously, and nothing would look broken.
-- That is the failure this file exists to prevent.
--
-- See docs/adr/0003-tenant-isolation-strategy.md.
-- =====================================================================================

\set ON_ERROR_STOP on

-- -------------------------------------------------------------------------------------
-- Migration role
-- -------------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sankofa_migrate') THEN
        EXECUTE format('CREATE ROLE sankofa_migrate LOGIN PASSWORD %L BYPASSRLS',
                       current_setting('bootstrap.migrate_password'));
        RAISE NOTICE 'Created role sankofa_migrate';
    ELSE
        RAISE NOTICE 'Role sankofa_migrate already exists; leaving it alone';
    END IF;
END
$$;

-- -------------------------------------------------------------------------------------
-- Application role
--
-- NOTHING is granted here beyond the ability to log in. Schema and table privileges are
-- granted by the migrations themselves, so that a new table's access is decided in the same
-- reviewed change that creates it rather than by a blanket grant nobody revisits.
-- -------------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sankofa_app') THEN
        EXECUTE format('CREATE ROLE sankofa_app LOGIN PASSWORD %L',
                       current_setting('bootstrap.app_password'));
        RAISE NOTICE 'Created role sankofa_app';
    ELSE
        RAISE NOTICE 'Role sankofa_app already exists; leaving it alone';
    END IF;
END
$$;

-- -------------------------------------------------------------------------------------
-- Assert the attributes, every time
--
-- An existing role might have been created by hand, or altered since. Re-running this file
-- must either confirm the guarantee or refuse. A silent pass over a role that has quietly
-- acquired SUPERUSER is exactly the situation that makes an isolation breach possible while
-- every test stays green.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
      INTO r
      FROM pg_roles WHERE rolname = 'sankofa_app';

    IF r.rolsuper THEN
        RAISE EXCEPTION 'sankofa_app is a SUPERUSER. It would bypass every row level security '
                        'policy in the schema, silently disabling tenant isolation. '
                        'Fix with: ALTER ROLE sankofa_app NOSUPERUSER;';
    END IF;
    IF r.rolbypassrls THEN
        RAISE EXCEPTION 'sankofa_app holds BYPASSRLS, which defeats every tenant policy. '
                        'Fix with: ALTER ROLE sankofa_app NOBYPASSRLS;';
    END IF;
    IF r.rolcreaterole THEN
        RAISE EXCEPTION 'sankofa_app holds CREATEROLE, which is a privilege-escalation path. '
                        'Fix with: ALTER ROLE sankofa_app NOCREATEROLE;';
    END IF;

    RAISE NOTICE 'Verified: sankofa_app is a plain login role. RLS applies to it.';
END
$$;

-- -------------------------------------------------------------------------------------
-- Database
--
-- Owned by the migration role so Flyway can create schemas. Uncomment when provisioning a
-- fresh cluster; CREATE DATABASE cannot run inside a transaction block, so it is left
-- separate rather than wrapped above.
-- -------------------------------------------------------------------------------------
-- CREATE DATABASE sankofa OWNER sankofa_migrate ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'
--     TEMPLATE template0;

-- Revoke the default PUBLIC grant so a future role cannot connect merely by existing.
-- Run this connected TO the application database, not to `postgres`.
-- REVOKE ALL ON DATABASE sankofa FROM PUBLIC;
-- GRANT CONNECT ON DATABASE sankofa TO sankofa_app, sankofa_migrate;

-- PUBLIC can create objects in the `public` schema by default on older clusters. A tenant-
-- facing application role has no business creating tables.
-- REVOKE CREATE ON SCHEMA public FROM PUBLIC;
