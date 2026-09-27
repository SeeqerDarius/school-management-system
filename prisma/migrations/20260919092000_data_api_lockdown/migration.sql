-- =====================================================================================
-- Supabase Data API lockdown.
--
-- Prisma emits no GRANT, no REVOKE and no ENABLE ROW LEVEL SECURITY — its schema language
-- has no concept of any of them. On Supabase that is not a gap, it is a hole: PostgREST
-- serves schema "public" at https://<project-ref>.supabase.co/rest/v1/ to anyone holding
-- the project's publishable ("anon") key, which is public by design and ships in client
-- bundles. Whether a table is readable from the internet is decided by table GRANTs, with
-- row-level security as the second gate. Until this file, this repository controlled
-- neither.
--
-- Left alone, `GET /rest/v1/app_user?select=*` returns every row of the user table,
-- bcrypt hashes included, and PATCH/POST/DELETE reach the ledger.
--
-- Every statement here is idempotent and correct in all three states we may be in:
--   * a project created with "Automatically expose new tables and functions" ON
--     (the behaviour before 2026-05-30): this closes the hole;
--   * a project created with it OFF (the current platform default): this is a no-op;
--   * bare PostgreSQL, as in the CI `database` job and in local development: the Supabase
--     roles do not exist, so section 2 is skipped and only the portable half runs.
--
-- We cannot tell which of the first two the project is in — the toggle is set by a human
-- at creation time and is not visible in the catalog — so this does not try to detect it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Deny-all row level security on every table in "public".
--
-- RLS is enabled and no policy is created, so every role that does not bypass RLS can
-- read and write nothing. That is the whole protection: a policy-less table under RLS is
-- closed, not open.
--
-- It does not constrain this application, because `postgres` carries BYPASSRLS and that
-- is the role Prisma connects as. Read the note at the foot of this file before drawing
-- any comfort from "RLS is on".
--
-- Portable: it names no Supabase role, so CI exercises it on plain PostgreSQL and
-- tests/db/data-api-lockdown.test.ts asserts it there.
-- -------------------------------------------------------------------------------------
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
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
  END LOOP;
END
$$;

-- -------------------------------------------------------------------------------------
-- 2. Take the Data API roles' privileges away. Supabase only.
--
-- The role guard is not defensive politeness. `REVOKE ... FROM anon` raises
-- `role "anon" does not exist` (SQLSTATE 42704) on the postgres:17 container CI runs
-- against, which would fail `prisma migrate deploy` and red-line every pull request. The
-- predictable reaction to that is to delete these statements rather than guard them,
-- which is precisely the "work around the gate by weakening the rule" that AGENTS.md
-- forbids.
-- -------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'anon/authenticated absent: not a Supabase database, skipping Data API lockdown';
    RETURN;
  END IF;

  -- Existing objects, including _prisma_migrations.
  EXECUTE 'REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon, authenticated';

  -- Future objects created by `postgres`, the role `prisma migrate deploy` connects as.
  -- This is the statement that survives the next migration creating a new table; the RLS
  -- loop above does not, because default privileges carry no RLS component.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated';

  -- Functions are granted to the PUBLIC pseudo-role by default, which anon reaches
  -- through, so revoking from anon by name is not enough for routines.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC';
END
$$;

-- -------------------------------------------------------------------------------------
-- Deliberately NOT done here, so that neither is proposed again without the argument:
--
--   REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
--     Ineffective alone. Schema "public" also carries USAGE for the PUBLIC pseudo-role,
--     so anon keeps it and `has_schema_privilege('anon','public','USAGE')` still returns
--     true — verified live on a sibling project. Making it bite needs
--     REVOKE ... FROM PUBLIC, which strips every role without a separate grant, including
--     Supabase's own auth, storage and realtime admin roles. With no table privileges
--     left, USAGE on the schema reaches nothing, so the risk buys no protection.
--
--   Anything touching service_role.
--     It is reachable only with the secret service key, which this application never uses
--     and never stores. Revoking it would break the dashboard's own table editor.
--
-- WHAT THIS FILE DOES NOT PROTECT AGAINST
--
--   Prisma connects as `postgres`, which has BYPASSRLS. The RLS above is a wall around
--   the Data API roles and nothing else. It does nothing about a missing tenant filter in
--   our own code — that remains the job of src/server/tenant-scope.ts, and remains the
--   product's #1 known weakness.
--
--   Making RLS a real second line of defence means connecting as a role WITHOUT
--   BYPASSRLS, and that cannot be done until per-tenant policies exist: point a
--   non-bypassing role at these policy-less tables and every query in the product returns
--   nothing. The role SQL and the staging are in IMPLEMENTATION_STATUS.md. Do not switch
--   the role first.
-- -------------------------------------------------------------------------------------
