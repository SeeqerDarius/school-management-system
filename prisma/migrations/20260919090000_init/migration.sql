-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OnboardingState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_INVITE', 'ACTIVE', 'DISABLED', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'SCHOOL');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('STAFF', 'TEACHER', 'STUDENT', 'GUARDIAN', 'PLATFORM', 'SUPPORT');

-- CreateEnum
CREATE TYPE "GrantEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CampusStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "CalendarStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "shortName" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
    "countryCode" CHAR(2) NOT NULL,
    "defaultCurrency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-GH',
    "dateFormat" TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
    "customDomain" TEXT,
    "onboardingState" "OnboardingState" NOT NULL DEFAULT 'NOT_STARTED',
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_sequence" (
    "tenantId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL DEFAULT '',
    "prefix" TEXT NOT NULL DEFAULT '',
    "padWidth" INTEGER NOT NULL DEFAULT 6,
    "nextValue" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_sequence_pkey" PRIMARY KEY ("tenantId","scope","periodKey")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "preferredName" TEXT,
    "phoneE164" TEXT,
    "avatarPath" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_INVITE',
    "mfaEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "sessionsValidFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "isChildSensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "RoleScope" NOT NULL DEFAULT 'SCHOOL',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isAssignable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "campusId" UUID,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "principalType" "PrincipalType" NOT NULL,
    "principalId" UUID,
    "displayTitle" TEXT,
    "startedOn" DATE,
    "endedOn" DATE,
    "invitedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_role" (
    "membershipId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_role_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "membership_permission_grant" (
    "membershipId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "effect" "GrantEffect" NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "membership_permission_grant_pkey" PRIMARY KEY ("membershipId","permissionId")
);

-- CreateTable
CREATE TABLE "security_event" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "tenantId" UUID,
    "eventType" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'INFO',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorUserId" UUID,
    "actorMembershipId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" UUID,
    "resourceRef" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "status" "CampusStatus" NOT NULL DEFAULT 'ACTIVE',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" CHAR(2),
    "phoneE164" TEXT,
    "email" TEXT,
    "timezone" TEXT,
    "openedOn" DATE,
    "closedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branding" (
    "tenantId" UUID NOT NULL,
    "motto" TEXT,
    "logoPath" TEXT,
    "logoUpdatedAt" TIMESTAMP(3),
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "reportCardHeader" TEXT,
    "receiptHeader" TEXT,
    "invoiceHeader" TEXT,
    "documentFooter" TEXT,
    "headSignatureName" TEXT,
    "headSignatureTitle" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branding_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "academic_year" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "CalendarStatus" NOT NULL DEFAULT 'PLANNED',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "CalendarStatus" NOT NULL DEFAULT 'PLANNED',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "reportsDueOn" DATE,
    "closedAt" TIMESTAMP(3),
    "closedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "term_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_customDomain_key" ON "tenant"("customDomain");

-- CreateIndex
CREATE INDEX "tenant_status_idx" ON "tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_inviteTokenHash_key" ON "app_user"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "app_user_status_idx" ON "app_user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "permission_module_idx" ON "permission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenantId_code_key" ON "role"("tenantId", "code");

-- CreateIndex
CREATE INDEX "role_permission_permissionId_idx" ON "role_permission"("permissionId");

-- CreateIndex
CREATE INDEX "membership_userId_status_idx" ON "membership"("userId", "status");

-- CreateIndex
CREATE INDEX "membership_tenantId_status_idx" ON "membership"("tenantId", "status");

-- CreateIndex
CREATE INDEX "membership_tenantId_principalType_principalId_idx" ON "membership"("tenantId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenantId_userId_principalType_key" ON "membership"("tenantId", "userId", "principalType");

-- CreateIndex
CREATE INDEX "membership_role_roleId_idx" ON "membership_role"("roleId");

-- CreateIndex
CREATE INDEX "security_event_userId_occurredAt_idx" ON "security_event"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "security_event_tenantId_occurredAt_idx" ON "security_event"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "security_event_eventType_occurredAt_idx" ON "security_event"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_occurredAt_idx" ON "audit_log"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_actorUserId_occurredAt_idx" ON "audit_log"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_resourceType_resourceId_occurredAt_idx" ON "audit_log"("resourceType", "resourceId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_action_occurredAt_idx" ON "audit_log"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "campus_tenantId_status_idx" ON "campus"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campus_tenantId_code_key" ON "campus"("tenantId", "code");

-- CreateIndex
CREATE INDEX "academic_year_tenantId_status_idx" ON "academic_year"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_tenantId_code_key" ON "academic_year"("tenantId", "code");

-- CreateIndex
CREATE INDEX "term_tenantId_status_idx" ON "term"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "term_academicYearId_sequence_key" ON "term"("academicYearId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "term_academicYearId_code_key" ON "term"("academicYearId", "code");

-- AddForeignKey
ALTER TABLE "reference_sequence" ADD CONSTRAINT "reference_sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_permission_grant" ADD CONSTRAINT "membership_permission_grant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_permission_grant" ADD CONSTRAINT "membership_permission_grant_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus" ADD CONSTRAINT "campus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branding" ADD CONSTRAINT "branding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_year"("id") ON DELETE CASCADE ON UPDATE CASCADE;

