-- =====================================================================================
-- Tenant isolation inside the database.
--
-- Until this migration, row-level security was enabled on every table and no policy
-- existed, which closes Supabase's Data API (20260919092000) and does nothing whatever
-- for tenancy. Isolation rested entirely on the Prisma client extension in
-- src/server/tenant-scope.ts — application code, which a raw query walks straight past.
--
-- This file supplies the missing half: per-tenant policies, and a login role that does
-- NOT carry BYPASSRLS so the policies actually bind. Enabling RLS and then connecting as
-- a bypassing role is the classic way to ship "row-level security" that enforces nothing,
-- and a catalog check for relrowsecurity does not catch it — which is why
-- tests/db/rls-policies.test.ts asserts behaviour under the restricted role instead.
--
-- ORDERING. The policies must exist before anything connects as the restricted role. A
-- non-bypassing role pointed at policy-less tables sees nothing at all, and every query
-- in the product returns empty. That is why both halves are in one migration.
--
-- The role is created NOLOGIN and without a password. A password in a migration is a
-- password in git. Granting it LOGIN is an operator step, documented in
-- docs/DEPLOYMENT.md, and until it is taken this migration changes nothing about how the
-- application connects.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. The request context.
--
-- Three settings, bound per transaction by src/server/db-context.ts:
--
--   app.tenant_id       the school this transaction acts for
--   app.user_id         the signed-in user, where one is known
--   app.sign_in_email   the address being authenticated, during sign-in only
--
-- The accessors use current_setting(..., true), which returns NULL when the setting is
-- absent rather than raising. NULL then fails every comparison below, so an unbound
-- transaction sees no rows — closed, and silent about it.
--
-- The raising form was considered and rejected on evidence. The previous Java
-- implementation used it, and a FOR ALL policy's USING clause is evaluated on SELECT too:
-- every membership lookup on the sign-in path, which is unscoped by definition, threw
-- SQLSTATE 42501 and surfaced as an opaque 500. The bug was in the design, not the
-- accessor, but a control that fails loudly in the one place it must not is a control
-- people disable. Returning nothing is enforced by test rather than by exception.
--
-- They live in `app` rather than `public` for the same reason btree_gist was moved there:
-- anything in `public` is a candidate PostgREST endpoint.
-- -------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_sign_in_email() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT NULLIF(current_setting('app.sign_in_email', true), '') $$;

COMMENT ON FUNCTION app.current_tenant_id() IS
  'The school the current transaction acts for. NULL when unbound, which every tenant policy treats as "no rows".';

-- -------------------------------------------------------------------------------------
-- 2. The application role.
--
-- NOBYPASSRLS is the whole point and is stated explicitly rather than left to the
-- default, because Supabase''s own Prisma guide tells you to create this role WITH
-- BYPASSRLS — which would reintroduce exactly the hole this migration closes.
--
-- NOLOGIN until an operator grants it. See docs/DEPLOYMENT.md.
-- -------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sankofa_app') THEN
    CREATE ROLE sankofa_app
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Re-asserted on every run rather than trusted: an existing role may have been altered by
-- hand, and the one attribute that matters silently voids every policy below.
ALTER ROLE sankofa_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT USAGE ON SCHEMA public, app TO sankofa_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sankofa_app;

-- Table privileges are the first gate; the policies below are the second. Both are
-- needed — a policy grants nothing on its own, and a GRANT without a policy is denied by
-- the RLS that 20260919092000 enabled.
DO $$
DECLARE
  rel regclass;
BEGIN
  FOR rel IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO sankofa_app', rel);
  END LOOP;
END
$$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sankofa_app;

-- Future tables and sequences. The application role inherits access; it does NOT inherit
-- a policy, so a new tenant-owned table is unreadable until its migration writes one.
-- tests/db/rls-policies.test.ts fails the build when a table carries tenantId and has no
-- policy, which is the trap this default privilege would otherwise set.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sankofa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sankofa_app;

-- -------------------------------------------------------------------------------------
-- 3. Strictly tenant-owned tables.
--
-- One school's rows, nothing else, read and write. `tenantId = NULL` is never true, so an
-- unbound transaction reads nothing and writes nothing.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_year', 'term', 'campus', 'branding', 'reference_sequence']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        AS PERMISSIVE FOR ALL TO sankofa_app
        USING ("tenantId" = app.current_tenant_id())
        WITH CHECK ("tenantId" = app.current_tenant_id())
    $f$, t);
  END LOOP;
END
$$;

-- -------------------------------------------------------------------------------------
-- 4. Membership — tenant-owned, but read across tenants during sign-in.
--
-- Choosing a school means listing the schools a person belongs to, before any school is
-- chosen. That read is unscoped by definition and is where the previous implementation
-- broke. It is expressible as a policy rather than an exception: with no tenant bound you
-- may see your own memberships and nobody else's.
--
-- Writes always require a bound tenant. A membership is created inside a school.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public.membership;
CREATE POLICY tenant_isolation ON public.membership
  AS PERMISSIVE FOR ALL TO sankofa_app
  USING (
    "tenantId" = app.current_tenant_id()
    OR (app.current_tenant_id() IS NULL AND "userId" = app.current_user_id())
  )
  WITH CHECK ("tenantId" = app.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- 5. Tables hanging off a membership.
--
-- No tenantId of their own. The rule is "the membership is visible to me", and because
-- the subquery is itself subject to membership's policy above, that is the whole
-- expression — the two cannot drift apart.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['membership_role', 'membership_permission_grant']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        AS PERMISSIVE FOR ALL TO sankofa_app
        USING (EXISTS (SELECT 1 FROM public.membership m WHERE m.id = "membershipId"))
        WITH CHECK (EXISTS (SELECT 1 FROM public.membership m WHERE m.id = "membershipId"))
    $f$, t);
  END LOOP;
END
$$;

-- -------------------------------------------------------------------------------------
-- 6. Role — shared templates plus a school's own.
--
-- A NULL tenantId means "every school may use this", not "belongs to the platform", so
-- reads match this school's rows OR the shared ones. Writes do not: one school cannot
-- rename a template the other twenty-five are using.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS role_read ON public.role;
CREATE POLICY role_read ON public.role
  AS PERMISSIVE FOR SELECT TO sankofa_app
  USING ("tenantId" = app.current_tenant_id() OR "tenantId" IS NULL);

DROP POLICY IF EXISTS role_write ON public.role;
CREATE POLICY role_write ON public.role
  AS PERMISSIVE FOR ALL TO sankofa_app
  USING ("tenantId" = app.current_tenant_id())
  WITH CHECK ("tenantId" = app.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- 7. Audit log — append-only, and scoped like any other tenant-owned table.
--
-- No UPDATE or DELETE policy exists, so the application role cannot amend or erase an
-- entry even with the table privilege. The append-only trigger is the other half.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_read ON public.audit_log;
CREATE POLICY audit_read ON public.audit_log
  AS PERMISSIVE FOR SELECT TO sankofa_app
  USING ("tenantId" = app.current_tenant_id());

DROP POLICY IF EXISTS audit_append ON public.audit_log;
CREATE POLICY audit_append ON public.audit_log
  AS PERMISSIVE FOR INSERT TO sankofa_app
  WITH CHECK ("tenantId" = app.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- 8. Security events — writable when nothing is bound, which is exactly when they matter.
--
-- A refused sign-in has no tenant and often no user. The previous implementation made the
-- security log unwritable in precisely that case and had to be fixed after the fact; the
-- INSERT policy here allows a NULL tenant deliberately.
--
-- The SELECT policy has to admit those rows too, and that is not a second concession — it
-- is the same one. Prisma emits INSERT ... RETURNING for every create(), and PostgreSQL
-- evaluates the SELECT policy against the returned row: a row that may be written but not
-- read fails the statement with "new row violates row-level security policy", after the
-- write has already passed its WITH CHECK. A write-only policy is therefore not a thing
-- this application can use, whatever the intent.
--
-- Isolation survives intact, because the two arms are mutually exclusive. Bound to a
-- school you see that school's events and never the platform's; bound to nothing you see
-- the tenant-less ones and never any school's. No session sees another school's failures
-- under either arm.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS security_event_read ON public.security_event;
CREATE POLICY security_event_read ON public.security_event
  AS PERMISSIVE FOR SELECT TO sankofa_app
  USING (
    "tenantId" = app.current_tenant_id()
    OR (app.current_tenant_id() IS NULL AND "tenantId" IS NULL)
  );

DROP POLICY IF EXISTS security_event_append ON public.security_event;
CREATE POLICY security_event_append ON public.security_event
  AS PERMISSIVE FOR INSERT TO sankofa_app
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = app.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- 9. Tenant — the school itself.
--
-- Visible while acting for it, or while choosing between the schools you belong to. The
-- membership subquery carries its own policy, so "schools I belong to" needs no second
-- definition here. No write policy: provisioning a school is a platform action that runs
-- as the owner, not something the application role may do.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_visibility ON public.tenant;
CREATE POLICY tenant_visibility ON public.tenant
  AS PERMISSIVE FOR SELECT TO sankofa_app
  USING (
    id = app.current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM public.membership m
      WHERE m."tenantId" = public.tenant.id
        AND m."userId" = app.current_user_id()
        AND m.status = 'ACTIVE'
    )
  );

-- -------------------------------------------------------------------------------------
-- 10. Users.
--
-- app_user is not tenant-owned — a person may hold memberships in several schools — so
-- there is no tenant rule to apply. An authenticated transaction sees its own row. Sign-in
-- is the exception it has to be: the password must be verified before the user is known,
-- so the address being authenticated is bound to app.sign_in_email and the policy admits
-- exactly that one row. An unbound transaction sees nobody.
--
-- This is narrower than it was: before this migration any query reaching the table read
-- every row, bcrypt hashes included.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS app_user_read ON public.app_user;
CREATE POLICY app_user_read ON public.app_user
  AS PERMISSIVE FOR SELECT TO sankofa_app
  USING (id = app.current_user_id() OR email = app.current_sign_in_email());

DROP POLICY IF EXISTS app_user_self_update ON public.app_user;
CREATE POLICY app_user_self_update ON public.app_user
  AS PERMISSIVE FOR UPDATE TO sankofa_app
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());

-- -------------------------------------------------------------------------------------
-- 11. The permission catalogue — global, and read-only to the application.
--
-- 142 permissions and their role grants are the same for every school. There is no write
-- policy: the catalogue is seeded by a migration running as the owner, so the application
-- cannot grant itself a permission it was not seeded with.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS catalogue_read ON public.permission;
CREATE POLICY catalogue_read ON public.permission
  AS PERMISSIVE FOR SELECT TO sankofa_app USING (true);

DROP POLICY IF EXISTS catalogue_read ON public.role_permission;
CREATE POLICY catalogue_read ON public.role_permission
  AS PERMISSIVE FOR SELECT TO sankofa_app USING (true);
