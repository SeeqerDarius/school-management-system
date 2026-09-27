-- CreateEnum
CREATE TYPE "RegisterStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "attendance_register" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classGroupId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "sessionDate" DATE NOT NULL,
    "status" "RegisterStatus" NOT NULL DEFAULT 'DRAFT',
    "takenByMembershipId" UUID,
    "submittedAt" TIMESTAMP(3),
    "submittedByMembershipId" UUID,
    "lockedAt" TIMESTAMP(3),
    "lockedByMembershipId" UUID,
    "lockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_entry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "registerId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "minutesLate" INTEGER,
    "reason" TEXT,
    "markedByMembershipId" UUID,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correctedAt" TIMESTAMP(3),
    "correctedByMembershipId" UUID,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_register_tenantId_sessionDate_idx" ON "attendance_register"("tenantId", "sessionDate");

-- CreateIndex
CREATE INDEX "attendance_register_tenantId_status_idx" ON "attendance_register"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_register_id_tenantId_key" ON "attendance_register"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_register_classGroupId_sessionDate_key" ON "attendance_register"("classGroupId", "sessionDate");

-- CreateIndex
CREATE INDEX "attendance_entry_tenantId_studentId_idx" ON "attendance_entry"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_entry_id_tenantId_key" ON "attendance_entry"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_entry_registerId_studentId_key" ON "attendance_entry"("registerId", "studentId");

-- AddForeignKey
ALTER TABLE "attendance_register" ADD CONSTRAINT "attendance_register_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_register" ADD CONSTRAINT "attendance_register_classGroupId_tenantId_fkey" FOREIGN KEY ("classGroupId", "tenantId") REFERENCES "class_group"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_register" ADD CONSTRAINT "attendance_register_termId_tenantId_fkey" FOREIGN KEY ("termId", "tenantId") REFERENCES "term"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_registerId_tenantId_fkey" FOREIGN KEY ("registerId", "tenantId") REFERENCES "attendance_register"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_studentId_tenantId_fkey" FOREIGN KEY ("studentId", "tenantId") REFERENCES "student"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================================
-- Hand-written from here. A register is evidence: it is read back by a statutory return, by a
-- safeguarding review and, when a child comes to harm, by somebody asking who knew they were
-- not in school. Rules that live only in a Server Action are rules a script, a support query
-- or a bug walks straight past.
-- =====================================================================================

ALTER TABLE "attendance_register" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_entry" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.attendance_register;
CREATE POLICY tenant_isolation ON public.attendance_register
  AS PERMISSIVE FOR ALL TO sankofa_app
  USING ("tenantId" = app.current_tenant_id())
  WITH CHECK ("tenantId" = app.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.attendance_entry;
CREATE POLICY tenant_isolation ON public.attendance_entry
  AS PERMISSIVE FOR ALL TO sankofa_app
  USING ("tenantId" = app.current_tenant_id())
  WITH CHECK ("tenantId" = app.current_tenant_id());

-- -------------------------------------------------------------------------------------
-- A register cannot be taken for a day that has not happened.
-- -------------------------------------------------------------------------------------
ALTER TABLE "attendance_register"
  ADD CONSTRAINT attendance_register_not_in_the_future
  CHECK ("sessionDate" <= (CURRENT_DATE + 1));

-- -------------------------------------------------------------------------------------
-- The status and its timestamps say the same thing.
--
-- Written as a CASE over the status rather than as a conjunction of implications, because the
-- conjunction form is where a NULL slips through: a CHECK rejects a row only when it evaluates
-- to FALSE, and any comparison against NULL is NULL.
-- -------------------------------------------------------------------------------------
ALTER TABLE "attendance_register"
  ADD CONSTRAINT attendance_register_status_coherent
  CHECK (
    CASE status
      WHEN 'DRAFT'     THEN "submittedAt" IS NULL AND "lockedAt" IS NULL
      WHEN 'SUBMITTED' THEN "submittedAt" IS NOT NULL AND "lockedAt" IS NULL
      WHEN 'LOCKED'    THEN "submittedAt" IS NOT NULL AND "lockedAt" IS NOT NULL
                            AND "lockedReason" IS NOT NULL
                            AND length(btrim("lockedReason")) >= 8
    END
  );

-- -------------------------------------------------------------------------------------
-- An excused absence states why, and only a late child has a lateness.
-- -------------------------------------------------------------------------------------
ALTER TABLE "attendance_entry"
  ADD CONSTRAINT attendance_entry_excused_is_reasoned
  CHECK (
    status <> 'EXCUSED'
    OR (reason IS NOT NULL AND length(btrim(reason)) >= 3)
  );

ALTER TABLE "attendance_entry"
  ADD CONSTRAINT attendance_entry_lateness_belongs_to_late
  CHECK (
    ("minutesLate" IS NULL)
    OR (status = 'LATE' AND "minutesLate" > 0 AND "minutesLate" <= 600)
  );

-- -------------------------------------------------------------------------------------
-- A register's day falls inside its term.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.attendance_register_within_term() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
DECLARE
  v_starts date;
  v_ends   date;
BEGIN
  SELECT t."startsOn", t."endsOn" INTO v_starts, v_ends
  FROM public.term t
  WHERE t.id = NEW."termId" AND t."tenantId" = NEW."tenantId";

  IF v_starts IS NULL THEN
    RAISE EXCEPTION 'term % does not belong to this school', NEW."termId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW."sessionDate" < v_starts OR NEW."sessionDate" > v_ends THEN
    RAISE EXCEPTION 'session date % is outside the term it names', NEW."sessionDate"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS attendance_register_within_term ON "attendance_register";
CREATE TRIGGER attendance_register_within_term
  BEFORE INSERT OR UPDATE OF "sessionDate", "termId" ON "attendance_register"
  FOR EACH ROW EXECUTE FUNCTION app.attendance_register_within_term();

-- -------------------------------------------------------------------------------------
-- LOCKED is final, and SUBMITTED means every child was accounted for.
--
-- Invariant I-3 applied to attendance: a locked register is not updatable, not deletable and
-- not unlockable, by anybody — including a platform administrator. A register locked in error
-- is corrected the way a posted journal is, by a further record, not by editing the evidence.
--
-- Invariant I-9: a register cannot be SUBMITTED while a child on the roll has no mark. A child
-- with no mark is not a child recorded as away; it is a child nobody accounted for, which is
-- precisely the state a register exists to make visible.
--
-- SECURITY DEFINER is load-bearing. The completeness check reads `enrolment`, which is behind a
-- tenant policy: run under the caller's RLS it would see zero enrolments, conclude every child
-- was marked, and pass. A check that can pass by seeing nothing fails silently and in the
-- direction of everything being fine.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.attendance_register_transition() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
DECLARE
  v_unmarked bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'LOCKED' THEN
      RAISE EXCEPTION 'a locked register cannot be deleted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'a locked register cannot be changed, including unlocked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'a submitted register cannot be reopened; correct it instead'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'SUBMITTED' AND (TG_OP = 'INSERT' OR OLD.status <> 'SUBMITTED') THEN
    SELECT count(*) INTO v_unmarked
    FROM public.enrolment e
    WHERE e."classId" = NEW."classGroupId"
      AND e."tenantId" = NEW."tenantId"
      AND e."termId" = NEW."termId"
      AND e.status IN ('PENDING', 'ACTIVE')
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance_entry a
        WHERE a."registerId" = NEW.id AND a."studentId" = e."studentId"
      );

    IF v_unmarked > 0 THEN
      RAISE EXCEPTION '% child(ren) on the roll have no mark', v_unmarked
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS attendance_register_transition ON "attendance_register";
CREATE TRIGGER attendance_register_transition
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_register"
  FOR EACH ROW EXECUTE FUNCTION app.attendance_register_transition();

-- -------------------------------------------------------------------------------------
-- A mark can only be written while its register is open.
--
-- The register's own status is the gate, so this reads it — again as SECURITY DEFINER, for the
-- same reason: a guard that cannot see the register would let every mark through.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.attendance_entry_register_open() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
DECLARE
  v_status text;
  v_register uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_register := OLD."registerId";
  ELSE
    v_register := NEW."registerId";
  END IF;

  SELECT r.status::text INTO v_status
  FROM public.attendance_register r
  WHERE r.id = v_register;

  IF v_status = 'LOCKED' THEN
    RAISE EXCEPTION 'a locked register cannot be marked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS attendance_entry_register_open ON "attendance_entry";
CREATE TRIGGER attendance_entry_register_open
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_entry"
  FOR EACH ROW EXECUTE FUNCTION app.attendance_entry_register_open();
