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
CREATE EXTENSION IF NOT EXISTS btree_gist;

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
