-- =====================================================================================
-- Invariants the Prisma schema language cannot express.
--
-- Everything here is enforced by the database rather than by application code. The
-- application checks the same rules first, because it can say "those dates overlap the
-- 2026/2027 year" and a constraint violation cannot — but the application is not what
-- guarantees them. A bug, a console session, a future import script or a second service
-- all reach the same tables, and only the database is behind all of them.
-- =====================================================================================

-- Required for an exclusion constraint that mixes equality (a uuid) with overlap (a range).
-- A plain btree index cannot answer "overlaps"; a plain gist index cannot answer "equals".
--
-- The schema is named rather than left to search_path. Unqualified, PostgreSQL installs an
-- extension into the first valid entry of the effective search_path, which is "public" both on
-- Supabase (the postgres role's search_path is '"$user", public, extensions' and no "postgres"
-- schema exists) and on a bare container. Anything in "public" on Supabase is published through
-- PostgREST and pg_graphql: a hundred gist support functions would become a hundred callable
-- endpoints on a database of children's records.
--
-- "extensions" already exists on Supabase, so CREATE SCHEMA is a no-op there; on CI and on a
-- laptop it creates it. That is what lets this be one file for all three. Naming the schema
-- cannot break the constraints below: the default gist operator class for uuid is found by a
-- catalog scan of pg_opclass with no search_path filtering, and the constraint then stores
-- operator OIDs rather than names, so nothing is looked up by name at query time.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- -------------------------------------------------------------------------------------
-- Ordering
--
-- An end before its start is not a short period, it is a corrupt row: every duration,
-- every "is this date inside the term" test and every report built on it silently
-- produces nonsense.
-- -------------------------------------------------------------------------------------
ALTER TABLE "academic_year"
  ADD CONSTRAINT "academic_year_dates_ordered" CHECK ("endsOn" > "startsOn");

ALTER TABLE "term"
  ADD CONSTRAINT "term_dates_ordered" CHECK ("endsOn" > "startsOn");

-- -------------------------------------------------------------------------------------
-- Non-overlap
--
-- Two academic years running at once inside one school means a date belongs to both, and
-- "which year is this attendance record in" stops having an answer. Same for two terms
-- inside a year.
--
-- The ranges are inclusive of both ends ('[]'), because a term that runs to the 20th
-- includes the 20th — a school year is a set of days, not a half-open interval.
-- -------------------------------------------------------------------------------------
ALTER TABLE "academic_year"
  ADD CONSTRAINT "academic_year_no_overlap"
  EXCLUDE USING gist (
    "tenantId" WITH =,
    daterange("startsOn", "endsOn", '[]') WITH &&
  );

ALTER TABLE "term"
  ADD CONSTRAINT "term_no_overlap"
  EXCLUDE USING gist (
    "academicYearId" WITH =,
    daterange("startsOn", "endsOn", '[]') WITH &&
  );

-- -------------------------------------------------------------------------------------
-- At most one current academic year per school, and one current term per year.
--
-- "Current" as a boolean on every row admits two rows claiming it at once, and then the
-- answer to "which year does new work default to" depends on sort order. A partial unique
-- index makes the second one impossible rather than merely unlikely.
-- -------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "academic_year_one_current_per_tenant"
  ON "academic_year" ("tenantId")
  WHERE "isCurrent";

CREATE UNIQUE INDEX "term_one_current_per_year"
  ON "term" ("academicYearId")
  WHERE "isCurrent";

-- -------------------------------------------------------------------------------------
-- System role codes are unique.
--
-- `@@unique([tenantId, code])` does not cover the system roles, because their tenantId is
-- NULL and PostgreSQL treats every NULL as distinct — so that constraint happily permits
-- two different roles both called SCHOOL_ADMINISTRATOR. Seeding upserts by code, so the
-- duplicate would not appear until some later run matched the wrong one.
-- -------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "role_system_code_key"
  ON "role" ("code")
  WHERE "tenantId" IS NULL;

-- -------------------------------------------------------------------------------------
-- A closed period records who closed it and when.
--
-- Without this, a row can sit in CLOSED with a null closedBy, and the one question an
-- auditor always asks — who signed off on this — has no answer in the data.
-- -------------------------------------------------------------------------------------
ALTER TABLE "academic_year"
  ADD CONSTRAINT "academic_year_closure_recorded" CHECK (
    ("status" <> 'CLOSED') OR ("closedAt" IS NOT NULL AND "closedBy" IS NOT NULL)
  );

ALTER TABLE "term"
  ADD CONSTRAINT "term_closure_recorded" CHECK (
    ("status" <> 'CLOSED') OR ("closedAt" IS NOT NULL AND "closedBy" IS NOT NULL)
  );

-- A closed period is never the current one.
ALTER TABLE "academic_year"
  ADD CONSTRAINT "academic_year_closed_not_current" CHECK (
    "status" <> 'CLOSED' OR NOT "isCurrent"
  );

ALTER TABLE "term"
  ADD CONSTRAINT "term_closed_not_current" CHECK (
    "status" <> 'CLOSED' OR NOT "isCurrent"
  );
