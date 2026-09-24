-- =====================================================================================
-- Student, Guardian, and Enrolment Schema
--
-- This migration adds the core student management entities:
-- - Student: Personal and academic information for each student
-- - Guardian: Parent/guardian contact information
-- - GuardianRelationship: Links students to guardians with relationship types
-- - Enrolment: Links students to academic years/terms with class assignments
--
-- All tables are tenant-scoped with RLS policies for data isolation.
-- =====================================================================================

CREATE TYPE "StudentStatus" AS ENUM ('PROSPECTIVE', 'ENROLLED', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'DECEASED');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');
CREATE TYPE "GuardianRelationshipType" AS ENUM ('FATHER', 'MOTHER', 'GRANDFATHER', 'GRANDMOTHER', 'UNCLE', 'AUNT', 'LEGAL_GUARDIAN', 'SPONSOR', 'OTHER');
CREATE TYPE "EnrolmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'WITHDRAWN', 'SUSPENDED');

-- Create Student table
CREATE TABLE "student" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "campusId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "nationality" CHAR(2),
    "beceRawScore" INTEGER,
    "beceAggregate" INTEGER,
    "beceYear" INTEGER,
    "phoneE164" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "bloodType" TEXT,
    "medicalNotes" TEXT,
    "allergies" TEXT,
    "specialNeeds" TEXT,
    "admissionDate" DATE,
    "admissionNumber" TEXT,
    "previousSchool" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'PROSPECTIVE',
    "enrollmentDate" DATE,
    "withdrawalDate" DATE,
    "withdrawalReason" TEXT,
    "graduationDate" DATE,
    "photoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- Create Guardian table
CREATE TABLE "guardian" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "nationality" CHAR(2),
    "phoneE164" TEXT NOT NULL,
    "phoneE1642" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "occupation" TEXT,
    "employer" TEXT,
    "workPhone" TEXT,
    "nationalId" TEXT,
    "nationalIdType" TEXT,
    "photoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- Create GuardianRelationship table
CREATE TABLE "guardian_relationship" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "relationshipType" "GuardianRelationshipType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "canPickUp" BOOLEAN NOT NULL DEFAULT true,
    "paysFees" BOOLEAN NOT NULL DEFAULT false,
    "feePercentage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardian_relationship_pkey" PRIMARY KEY ("id")
);

-- Create Enrolment table
CREATE TABLE "enrolment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "classId" UUID,
    "gradeLevel" TEXT,
    "section" TEXT,
    "status" "EnrolmentStatus" NOT NULL DEFAULT 'PENDING',
    "enrolmentDate" DATE NOT NULL,
    "completionDate" DATE,
    "gpa" DECIMAL(4,2),
    "classRank" INTEGER,
    "totalStudents" INTEGER,
    "daysPresent" INTEGER,
    "daysAbsent" INTEGER,
    "daysLate" INTEGER,
    "feesOwed" DECIMAL(19,4),
    "feesPaid" DECIMAL(19,4),
    "currency" CHAR(3) NOT NULL DEFAULT 'GHS',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrolment_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "student_reference_key" ON "student"("reference");
CREATE INDEX "student_tenantId_status_idx" ON "student"("tenantId", "status");
CREATE INDEX "student_campusId_status_idx" ON "student"("campusId", "status");
CREATE INDEX "student_lastName_firstName_idx" ON "student"("lastName", "firstName");
CREATE UNIQUE INDEX "student_id_tenantId_key" ON "student"("id", "tenantId");

CREATE INDEX "guardian_tenantId_lastName_firstName_idx" ON "guardian"("tenantId", "lastName", "firstName");
CREATE UNIQUE INDEX "guardian_id_tenantId_key" ON "guardian"("id", "tenantId");

CREATE UNIQUE INDEX "guardian_relationship_studentId_guardianId_key" ON "guardian_relationship"("studentId", "guardianId");
CREATE INDEX "guardian_relationship_tenantId_studentId_idx" ON "guardian_relationship"("tenantId", "studentId");
CREATE INDEX "guardian_relationship_tenantId_guardianId_idx" ON "guardian_relationship"("tenantId", "guardianId");

CREATE UNIQUE INDEX "enrolment_studentId_termId_key" ON "enrolment"("studentId", "termId");
CREATE INDEX "enrolment_tenantId_academicYearId_termId_idx" ON "enrolment"("tenantId", "academicYearId", "termId");
CREATE INDEX "enrolment_tenantId_studentId_idx" ON "enrolment"("tenantId", "studentId");
CREATE INDEX "enrolment_tenantId_classId_idx" ON "enrolment"("tenantId", "classId");
CREATE INDEX "enrolment_tenantId_status_idx" ON "enrolment"("tenantId", "status");

-- Composite keys let the database enforce that every relationship stays inside one school.
CREATE UNIQUE INDEX "campus_id_tenantId_key" ON "campus"("id", "tenantId");
CREATE UNIQUE INDEX "academic_year_id_tenantId_key" ON "academic_year"("id", "tenantId");
CREATE UNIQUE INDEX "term_id_tenantId_key" ON "term"("id", "tenantId");

ALTER TABLE "term" ADD CONSTRAINT "term_academicYearId_tenantId_fkey"
  FOREIGN KEY ("academicYearId", "tenantId") REFERENCES "academic_year"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "term" DROP CONSTRAINT "term_academicYearId_fkey";
ALTER TABLE "student" ADD CONSTRAINT "student_campusId_tenantId_fkey"
  FOREIGN KEY ("campusId", "tenantId") REFERENCES "campus"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guardian_relationship" ADD CONSTRAINT "guardian_relationship_studentId_tenantId_fkey"
  FOREIGN KEY ("studentId", "tenantId") REFERENCES "student"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guardian_relationship" ADD CONSTRAINT "guardian_relationship_guardianId_tenantId_fkey"
  FOREIGN KEY ("guardianId", "tenantId") REFERENCES "guardian"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_studentId_tenantId_fkey"
  FOREIGN KEY ("studentId", "tenantId") REFERENCES "student"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_academicYearId_tenantId_fkey"
  FOREIGN KEY ("academicYearId", "tenantId") REFERENCES "academic_year"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_termId_tenantId_fkey"
  FOREIGN KEY ("termId", "tenantId") REFERENCES "term"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_campusId_tenantId_fkey"
  FOREIGN KEY ("campusId", "tenantId") REFERENCES "campus"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create foreign key constraints
ALTER TABLE "student" ADD CONSTRAINT "student_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guardian" ADD CONSTRAINT "guardian_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guardian_relationship" ADD CONSTRAINT "guardian_relationship_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS on new tables
ALTER TABLE "student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_relationship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sankofa_app role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sankofa_app') THEN
    RAISE NOTICE 'sankofa_app role does not exist, skipping RLS policies';
    RETURN;
  END IF;

  -- Student policies
  CREATE POLICY tenant_isolation_select ON student
    FOR SELECT TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_insert ON student
    FOR INSERT TO sankofa_app
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_update ON student
    FOR UPDATE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_delete ON student
    FOR DELETE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  -- Guardian policies
  CREATE POLICY tenant_isolation_select ON guardian
    FOR SELECT TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_insert ON guardian
    FOR INSERT TO sankofa_app
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_update ON guardian
    FOR UPDATE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_delete ON guardian
    FOR DELETE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  -- GuardianRelationship policies
  CREATE POLICY tenant_isolation_select ON guardian_relationship
    FOR SELECT TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_insert ON guardian_relationship
    FOR INSERT TO sankofa_app
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_update ON guardian_relationship
    FOR UPDATE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_delete ON guardian_relationship
    FOR DELETE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  -- Enrolment policies
  CREATE POLICY tenant_isolation_select ON enrolment
    FOR SELECT TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_insert ON enrolment
    FOR INSERT TO sankofa_app
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_update ON enrolment
    FOR UPDATE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenantId = current_setting('app.tenant_id', true)::uuid);

  CREATE POLICY tenant_isolation_delete ON enrolment
    FOR DELETE TO sankofa_app
    USING (tenantId = current_setting('app.tenant_id', true)::uuid);

  -- Grant privileges to sankofa_app
  GRANT SELECT, INSERT, UPDATE, DELETE ON student TO sankofa_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON guardian TO sankofa_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON guardian_relationship TO sankofa_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON enrolment TO sankofa_app;

END
$$;

-- Add new models to tenant scope coverage
-- These will be automatically picked up by tenantScopeCoverage.test.ts
