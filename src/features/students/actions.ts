'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { withRlsTransaction } from '@/server/tenant-scope';
import { requirePermission } from '@/server/auth/session';
import { recordAudit } from '@/server/audit';
import { P } from '@/lib/permissions';
import { allocateReference } from '@/lib/reference-allocator';
import { canTransitionStudent, STUDENT_STATUSES } from '@/lib/student-status';
import { canTransitionEnrolment, ENROLMENT_STATUSES } from '@/lib/enrolment-status';
import type {
  CreateStudentInput,
  UpdateStudentInput,
  CreateGuardianInput,
  UpdateGuardianInput,
  CreateGuardianRelationshipInput,
  UpdateGuardianRelationshipInput,
  CreateEnrolmentInput,
  UpdateEnrolmentInput,
} from './schema';
import {
  createStudentSchema, updateStudentSchema, createGuardianSchema, updateGuardianSchema,
  createGuardianRelationshipSchema, updateGuardianRelationshipSchema,
  createEnrolmentSchema, updateEnrolmentSchema,
} from './schema';

type Defined<T> = { [Key in keyof T]: Exclude<T[Key], undefined> };

function withoutUndefined<T extends Record<string, unknown>>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Defined<T>;
}

/**
 * Student management server actions.
 * All writes follow the pattern: validate → authorize → transact → audit → revalidate.
 */

/**
 * Create a new student.
 */
export async function createStudent(input: CreateStudentInput) {
  const data = createStudentSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.STUDENT_CREATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const campus = await tx.campus.findUnique({ where: { id: data.campusId }, select: { id: true } });
    if (!campus) throw new Error('Select an active campus belonging to this school.');
    // Allocate a human-facing reference number
    const reference = await allocateReference(tx, tenantId, 'STUDENT');

    const student = await tx.student.create({
      data: {
        ...withoutUndefined(data),
        tenantId,
        reference,
        dateOfBirth: new Date(data.dateOfBirth),
        admissionDate: data.admissionDate ? new Date(data.admissionDate) : null,
      },
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'STUDENT_CREATED',
      resourceType: 'Student',
      resourceId: student.id,
      resourceRef: student.reference,
      after: { firstName: student.firstName, lastName: student.lastName },
    });

    return student;
  });
}

/**
 * Update an existing student.
 */
export async function updateStudent(input: UpdateStudentInput) {
  const data = updateStudentSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.STUDENT_UPDATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const existing = await tx.student.findUnique({
      where: { id: data.id },
    });

    if (!existing) {
      throw new Error('Student not found');
    }
    if (data.campusId && !(await tx.campus.findUnique({ where: { id: data.campusId }, select: { id: true } }))) {
      throw new Error('Select a campus belonging to this school.');
    }

    const { id, ...fields } = data;
    const student = await tx.student.update({
      where: { id },
      data: withoutUndefined({
        ...fields,
        dateOfBirth: fields.dateOfBirth ? new Date(fields.dateOfBirth) : undefined,
        admissionDate: fields.admissionDate ? new Date(fields.admissionDate) : undefined,
      }),
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'STUDENT_UPDATED',
      resourceType: 'Student',
      resourceId: student.id,
      resourceRef: student.reference,
      after: { firstName: student.firstName, lastName: student.lastName },
    });

    return student;
  });
}

/**
 * Change student status.
 */
export async function changeStudentStatus(studentId: string, newStatus: string, reason?: string) {
  const parsed = z.object({ studentId: z.string().uuid(), newStatus: z.enum(STUDENT_STATUSES), reason: z.string().max(500).optional() }).parse({ studentId, newStatus, reason });
  const { tenantId, userId, membershipId } = await requirePermission(P.STUDENT_STATUS_CHANGE);

  return withRlsTransaction(tenantId, async (tx) => {
    const existing = await tx.student.findUnique({
      where: { id: parsed.studentId },
    });

    if (!existing) {
      throw new Error('Student not found');
    }
    if (!canTransitionStudent(existing.status, parsed.newStatus)) {
      throw new Error(`A student cannot move from ${existing.status} to ${parsed.newStatus}.`);
    }

    const student = await tx.student.update({
      where: { id: parsed.studentId },
      data: {
        status: parsed.newStatus,
        ...(parsed.newStatus === 'ENROLLED' && !existing.enrollmentDate ? { enrollmentDate: new Date() } : {}),
        withdrawalDate: parsed.newStatus === 'WITHDRAWN' ? new Date() : existing.withdrawalDate,
        ...(parsed.newStatus === 'WITHDRAWN' ? { withdrawalReason: parsed.reason ?? null } : {}),
        graduationDate: parsed.newStatus === 'GRADUATED' ? new Date() : existing.graduationDate,
      },
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'STUDENT_STATUS_CHANGED',
      resourceType: 'Student',
      resourceId: student.id,
      resourceRef: student.reference,
      ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
      before: { status: existing.status },
      after: { status: student.status },
    });

    return student;
  });
}

/**
 * Create a new guardian.
 */
export async function createGuardian(input: CreateGuardianInput) {
  const data = createGuardianSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.GUARDIAN_CREATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const guardian = await tx.guardian.create({
      data: withoutUndefined({
        ...withoutUndefined(data),
        tenantId,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
      }),
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'GUARDIAN_CREATED',
      resourceType: 'Guardian',
      resourceId: guardian.id,
      after: { firstName: guardian.firstName, lastName: guardian.lastName },
    });

    return guardian;
  });
}

/**
 * Update an existing guardian.
 */
export async function updateGuardian(input: UpdateGuardianInput) {
  const data = updateGuardianSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.GUARDIAN_UPDATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const existing = await tx.guardian.findUnique({
      where: { id: data.id },
    });

    if (!existing) {
      throw new Error('Guardian not found');
    }

    const { id, ...fields } = data;
    const guardian = await tx.guardian.update({
      where: { id },
      data: withoutUndefined({ ...fields, dateOfBirth: fields.dateOfBirth ? new Date(fields.dateOfBirth) : undefined }),
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'GUARDIAN_UPDATED',
      resourceType: 'Guardian',
      resourceId: guardian.id,
      after: { firstName: guardian.firstName, lastName: guardian.lastName },
    });

    return guardian;
  });
}

/**
 * Create a guardian-student relationship.
 */
export async function createGuardianRelationship(input: CreateGuardianRelationshipInput) {
  const data = createGuardianRelationshipSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.GUARDIAN_CREATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const [student, guardian] = await Promise.all([
      tx.student.findUnique({ where: { id: data.studentId }, select: { id: true } }),
      tx.guardian.findUnique({ where: { id: data.guardianId }, select: { id: true } }),
    ]);
    if (!student || !guardian) throw new Error('Select a student and guardian belonging to this school.');
    const relationship = await tx.guardianRelationship.create({
      data: {
        ...withoutUndefined(data),
        tenantId,
      },
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'GUARDIAN_RELATIONSHIP_CREATED',
      resourceType: 'GuardianRelationship',
      resourceId: relationship.id,
      after: { studentId: relationship.studentId, guardianId: relationship.guardianId },
    });

    return relationship;
  });
}

/**
 * Update a guardian-student relationship.
 */
export async function updateGuardianRelationship(input: UpdateGuardianRelationshipInput) {
  const data = updateGuardianRelationshipSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.GUARDIAN_UPDATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const existing = await tx.guardianRelationship.findUnique({
      where: { id: data.id },
    });

    if (!existing) {
      throw new Error('Guardian relationship not found');
    }

    const { id, ...fields } = data;
    const studentId = fields.studentId ?? existing.studentId;
    const guardianId = fields.guardianId ?? existing.guardianId;
    const [student, guardian] = await Promise.all([
      tx.student.findUnique({ where: { id: studentId }, select: { id: true } }),
      tx.guardian.findUnique({ where: { id: guardianId }, select: { id: true } }),
    ]);
    if (!student || !guardian) throw new Error('Select a student and guardian belonging to this school.');
    const relationship = await tx.guardianRelationship.update({ where: { id }, data: withoutUndefined(fields) });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'GUARDIAN_RELATIONSHIP_UPDATED',
      resourceType: 'GuardianRelationship',
      resourceId: relationship.id,
      after: { isPrimary: relationship.isPrimary, isEmergency: relationship.isEmergency },
    });

    return relationship;
  });
}

/**
 * Create a new enrolment.
 */
export async function createEnrolment(input: CreateEnrolmentInput) {
  const data = createEnrolmentSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.ENROLMENT_CREATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const [student, academicYear, term, campus] = await Promise.all([
      tx.student.findUnique({ where: { id: data.studentId }, select: { id: true, campusId: true } }),
      tx.academicYear.findUnique({ where: { id: data.academicYearId }, select: { id: true } }),
      tx.term.findUnique({ where: { id: data.termId }, select: { id: true, academicYearId: true } }),
      tx.campus.findUnique({ where: { id: data.campusId }, select: { id: true } }),
    ]);
    if (!student || !academicYear || !term || !campus || term.academicYearId !== academicYear.id || student.campusId !== campus.id) {
      throw new Error('Select a student, campus and academic period that belong together in this school.');
    }
    const enrolment = await tx.enrolment.create({
      data: {
        ...withoutUndefined(data),
        tenantId,
        enrolmentDate: new Date(data.enrolmentDate),
      },
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'ENROLMENT_CREATED',
      resourceType: 'Enrolment',
      resourceId: enrolment.id,
      after: { studentId: enrolment.studentId, termId: enrolment.termId },
    });

    return enrolment;
  });
}

/**
 * Update an existing enrolment.
 */
export async function updateEnrolment(input: UpdateEnrolmentInput) {
  const data = updateEnrolmentSchema.parse(input);
  const { tenantId, userId, membershipId } = await requirePermission(P.ENROLMENT_UPDATE);

  return withRlsTransaction(tenantId, async (tx) => {
    const existing = await tx.enrolment.findUnique({
      where: { id: data.id },
    });

    if (!existing) {
      throw new Error('Enrolment not found');
    }

    const { id, ...fields } = data;
    const [student, academicYear, term, campus] = await Promise.all([
      tx.student.findUnique({ where: { id: fields.studentId ?? existing.studentId }, select: { id: true, campusId: true } }),
      tx.academicYear.findUnique({ where: { id: fields.academicYearId ?? existing.academicYearId }, select: { id: true } }),
      tx.term.findUnique({ where: { id: fields.termId ?? existing.termId }, select: { id: true, academicYearId: true } }),
      tx.campus.findUnique({ where: { id: fields.campusId ?? existing.campusId }, select: { id: true } }),
    ]);
    if (!student || !academicYear || !term || !campus || term.academicYearId !== academicYear.id || student.campusId !== campus.id) {
      throw new Error('Select a student, campus and academic period that belong together in this school.');
    }
    const { feesOwed, feesPaid, ...nonMoneyFields } = fields;
    const enrolment = await tx.enrolment.update({
      where: { id },
      data: withoutUndefined({
        ...nonMoneyFields,
        ...(feesOwed === undefined ? {} : { feesOwed: new Prisma.Decimal(feesOwed) }),
        ...(feesPaid === undefined ? {} : { feesPaid: new Prisma.Decimal(feesPaid) }),
      }),
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'ENROLMENT_UPDATED',
      resourceType: 'Enrolment',
      resourceId: enrolment.id,
      after: { status: enrolment.status },
    });

    return enrolment;
  });
}

/**
 * Change enrolment status.
 */
export async function changeEnrolmentStatus(enrolmentId: string, newStatus: string, reason?: string) {
  const parsed = z.object({ enrolmentId: z.string().uuid(), newStatus: z.enum(ENROLMENT_STATUSES), reason: z.string().max(500).optional() }).parse({ enrolmentId, newStatus, reason });
  const { tenantId, userId, membershipId } = await requirePermission(P.ENROLMENT_STATUS_CHANGE);

  return withRlsTransaction(tenantId, async (tx) => {
    const existing = await tx.enrolment.findUnique({
      where: { id: parsed.enrolmentId },
    });

    if (!existing) {
      throw new Error('Enrolment not found');
    }
    if (!canTransitionEnrolment(existing.status, parsed.newStatus)) {
      throw new Error(`An enrolment cannot move from ${existing.status} to ${parsed.newStatus}.`);
    }

    const enrolment = await tx.enrolment.update({
      where: { id: parsed.enrolmentId },
      data: {
        status: parsed.newStatus,
        completionDate: parsed.newStatus === 'COMPLETED' ? new Date() : existing.completionDate,
      },
    });

    await recordAudit(tx, {
      tenantId,
      actorUserId: userId,
      actorMembershipId: membershipId,
      action: 'ENROLMENT_STATUS_CHANGED',
      resourceType: 'Enrolment',
      resourceId: enrolment.id,
      ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
      before: { status: existing.status },
      after: { status: enrolment.status },
    });

    return enrolment;
  });
}

/** Native form entry point. The form submits only fields it owns; tenant and actor always come
 * from the authenticated server session. */
export async function createStudentFromForm(formData: FormData): Promise<void> {
  const parsed = createStudentSchema.safeParse({
    campusId: formData.get('campusId'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    preferredName: formData.get('preferredName') || undefined,
    dateOfBirth: formData.get('dateOfBirth'),
    gender: formData.get('gender'),
    admissionDate: formData.get('admissionDate') || undefined,
    previousSchool: formData.get('previousSchool') || undefined,
  });
  if (!parsed.success) redirect('/students/new?error=invalid');

  const student = await createStudent(parsed.data);
  revalidatePath('/students');
  revalidatePath(`/students/${student.id}`);
  redirect('/students?created=1');
}
