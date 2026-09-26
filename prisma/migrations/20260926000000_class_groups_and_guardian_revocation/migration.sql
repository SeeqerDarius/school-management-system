-- AlterTable
ALTER TABLE "guardian_relationship" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedByMembershipId" UUID,
ADD COLUMN     "revokedReason" TEXT;

-- CreateTable
CREATE TABLE "class_group" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yearLevel" INTEGER,
    "classTeacherMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_group_tenantId_academicYearId_idx" ON "class_group"("tenantId", "academicYearId");

-- CreateIndex
CREATE INDEX "class_group_tenantId_classTeacherMembershipId_idx" ON "class_group"("tenantId", "classTeacherMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "class_group_id_tenantId_key" ON "class_group"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "class_group_tenantId_academicYearId_code_key" ON "class_group"("tenantId", "academicYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "membership_id_tenantId_key" ON "membership"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_classId_tenantId_fkey" FOREIGN KEY ("classId", "tenantId") REFERENCES "class_group"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_academicYearId_tenantId_fkey" FOREIGN KEY ("academicYearId", "tenantId") REFERENCES "academic_year"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_campusId_tenantId_fkey" FOREIGN KEY ("campusId", "tenantId") REFERENCES "campus"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_classTeacherMembershipId_tenantId_fkey" FOREIGN KEY ("classTeacherMembershipId", "tenantId") REFERENCES "membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Everything below is hand-written: Prisma's schema language has no way to say any of it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- A revoked guardian link states why it was revoked.
--
-- Written with an explicit IS NOT NULL, and that is not belt-and-braces. A CHECK rejects a
-- row only when it evaluates to FALSE: with a NULL reason `length(btrim(NULL)) >= 8` is
-- NULL, not FALSE, so a reasonless revocation goes straight in. That exact mistake was
-- already made once on this schema and caught by a test.
--
-- Eight characters is a low bar deliberately. It stops "" and "n/a"; it does not pretend
-- to judge whether the reason is a good one.
-- -------------------------------------------------------------------------------------
ALTER TABLE "guardian_relationship"
  ADD CONSTRAINT guardian_relationship_revocation_is_reasoned
  CHECK (
    "revokedAt" IS NULL
    OR ("revokedReason" IS NOT NULL AND length(btrim("revokedReason")) >= 8)
  );

COMMENT ON CONSTRAINT guardian_relationship_revocation_is_reasoned ON "guardian_relationship" IS
  'DATA_PRIVACY §6: access is withdrawn with a recorded reason, never silently.';

-- -------------------------------------------------------------------------------------
-- Row-level security for class_group.
--
-- AGENTS.md §5: a tenant-owned table gets tenant_id, RLS enabled, and its policy in the
-- same migration that creates it. Not in a later pass — a table that exists for one
-- release without a policy is a table the application role can read across every school
-- for that release, and ALTER DEFAULT PRIVILEGES has already granted it the table.
-- -------------------------------------------------------------------------------------
ALTER TABLE "class_group" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.class_group;
CREATE POLICY tenant_isolation ON public.class_group
  AS PERMISSIVE FOR ALL TO sankofa_app
  USING ("tenantId" = app.current_tenant_id())
  WITH CHECK ("tenantId" = app.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- A class teacher is a member of staff at the same school, and an active one.
--
-- The foreign key already carries tenantId, so it cannot be another school's membership.
-- What the key cannot say is that it must not be a parent or a pupil: principalType lives
-- on the referenced row, and no foreign key can constrain a column it does not name.
--
-- SECURITY DEFINER because the guard reads `membership`, which is itself behind a tenant
-- policy. Running under the caller's RLS, a guard that finds no row cannot tell "there is
-- no such membership" from "the policy is hiding it" — and would pass, in the direction of
-- everything being fine.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.class_teacher_is_staff() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW."classTeacherMembershipId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT m."principalType"::text INTO v_type
  FROM public.membership m
  WHERE m.id = NEW."classTeacherMembershipId" AND m."tenantId" = NEW."tenantId";

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'class teacher membership % does not belong to this school', NEW."classTeacherMembershipId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_type NOT IN ('STAFF', 'TEACHER') THEN
    RAISE EXCEPTION 'a % cannot be a class teacher', v_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS class_group_teacher_is_staff ON "class_group";
CREATE TRIGGER class_group_teacher_is_staff
  BEFORE INSERT OR UPDATE OF "classTeacherMembershipId" ON "class_group"
  FOR EACH ROW EXECUTE FUNCTION app.class_teacher_is_staff();

-- -------------------------------------------------------------------------------------
-- A class belongs to the year its enrolments are for.
--
-- enrolment already carries academicYearId of its own, and class_group carries one too.
-- Nothing stopped a Basic 5 enrolment in 2026/27 pointing at a class group belonging to
-- 2025/26 — both rows are valid, and only the pair is wrong.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.enrolment_class_year_agrees() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
DECLARE
  v_year uuid;
BEGIN
  IF NEW."classId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cg."academicYearId" INTO v_year
  FROM public.class_group cg
  WHERE cg.id = NEW."classId" AND cg."tenantId" = NEW."tenantId";

  IF v_year IS DISTINCT FROM NEW."academicYearId" THEN
    RAISE EXCEPTION 'class % is not a class of this enrolment''s academic year', NEW."classId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS enrolment_class_year_agrees ON "enrolment";
CREATE TRIGGER enrolment_class_year_agrees
  BEFORE INSERT OR UPDATE OF "classId", "academicYearId" ON "enrolment"
  FOR EACH ROW EXECUTE FUNCTION app.enrolment_class_year_agrees();
