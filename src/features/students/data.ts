import 'server-only';

import { withRlsTransaction } from '@/server/tenant-scope';
import { requirePermission } from '@/server/auth/session';
import { P } from '@/lib/permissions';
import { studentListQuerySchema } from './schema';
import type { StudentListQuery } from './schema';
import { z } from 'zod';

/**
 * Student data access layer.
 * All reads go through this file, with permission checks before data access.
 */

/**
 * Get a paginated list of students with optional filtering.
 */
export async function getStudents(input: StudentListQuery = { page: 1, limit: 20 }) {
  const query = studentListQuerySchema.parse(input);
  const { tenantId } = await requirePermission(P.STUDENT_READ);

  const where: Record<string, unknown> = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.campusId) {
    where.campusId = query.campusId;
  }

  if (query.search) {
    where.OR = [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { reference: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  return withRlsTransaction(tenantId, async (tx) => {
  const [students, total] = await Promise.all([
    tx.student.findMany({
      where,
      include: {
        campus: {
          select: { id: true, name: true, code: true },
        },
        guardianships: {
          include: {
            guardian: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phoneE164: true,
              },
            },
          },
        },
      },
      orderBy: { lastName: 'asc' },
      skip: ((query.page || 1) - 1) * (query.limit || 20),
      take: query.limit || 20,
    }),
    tx.student.count({ where }),
  ]);

  return {
    students,
    total,
    page: query.page || 1,
    limit: query.limit || 20,
    totalPages: Math.ceil(total / (query.limit || 20)),
  };
  });
}

/**
 * Get a single student by ID with full details.
 */
export async function getStudentById(id: string) {
  const studentId = z.string().uuid().parse(id);
  const { tenantId } = await requirePermission(P.STUDENT_READ);

  return withRlsTransaction(tenantId, async (tx) => {
  const student = await tx.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      reference: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      dateOfBirth: true,
      gender: true,
      admissionDate: true,
      admissionNumber: true,
      previousSchool: true,
      status: true,
      campus: {
        select: { id: true, name: true, code: true },
      },
      guardianships: {
        include: {
          guardian: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              phoneE164: true,
              phoneE1642: true,
              email: true,
              addressLine1: true,
              city: true,
              region: true,
              occupation: true,
            },
          },
        },
        orderBy: { isPrimary: 'desc' },
      },
      enrollments: {
        include: {
          academicYear: {
            select: { id: true, name: true, code: true },
          },
          term: {
            select: { id: true, name: true, code: true },
          },
          campus: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { enrolmentDate: 'desc' },
      },
    },
  });

  return student;
  });
}

/**
 * Get all guardians for a tenant.
 */
export async function getGuardians() {
  const { tenantId } = await requirePermission(P.GUARDIAN_READ);

  return withRlsTransaction(tenantId, (tx) => tx.guardian.findMany({
    orderBy: { lastName: 'asc' },
  }));
}

/** Campuses available to the current school for student admission. */
export async function getStudentCampuses() {
  const { tenantId } = await requirePermission(P.STUDENT_CREATE);
  return withRlsTransaction(tenantId, (tx) => tx.campus.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  }));
}

/**
 * Get a single guardian by ID.
 */
export async function getGuardianById(id: string) {
  const { tenantId } = await requirePermission(P.GUARDIAN_READ);

  return withRlsTransaction(tenantId, async (tx) => {
  const guardian = await tx.guardian.findUnique({
    where: { id },
    include: {
      relationships: {
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              reference: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!guardian) {
    throw new Error('Guardian not found');
  }

  return guardian;
  });
}

/**
 * Get all enrolments for a student.
 */
export async function getStudentEnrolments(studentId: string) {
  const { tenantId } = await requirePermission(P.ENROLMENT_READ);

  return withRlsTransaction(tenantId, (tx) => tx.enrolment.findMany({
    where: { studentId },
    include: {
      academicYear: {
        select: { id: true, name: true, code: true },
      },
      term: {
        select: { id: true, name: true, code: true },
      },
      campus: {
        select: { id: true, name: true, code: true },
      },
    },
    orderBy: { enrolmentDate: 'desc' },
  }));
}

/**
 * Get active enrolments for the current term.
 */
export async function getCurrentTermEnrolments(termId: string) {
  const { tenantId } = await requirePermission(P.ENROLMENT_READ);

  return withRlsTransaction(tenantId, (tx) => tx.enrolment.findMany({
    where: {
      termId,
      status: 'ACTIVE',
    },
    include: {
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          reference: true,
        },
      },
      campus: {
        select: { id: true, name: true, code: true },
      },
    },
    orderBy: {
      student: { lastName: 'asc' },
    },
  }));
}
