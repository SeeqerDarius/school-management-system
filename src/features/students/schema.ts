import { z } from 'zod';

/**
 * Validation schemas for student management.
 * All forms are validated server-side before any database operations.
 */

// Student schemas
export const createStudentSchema = z.object({
  campusId: z.string().uuid('Invalid campus ID'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  preferredName: z.string().max(100).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
  nationality: z.string().length(2).optional(),
  beceRawScore: z.number().int().min(0).max(100).optional(),
  beceAggregate: z.number().int().min(1).max(60).optional(),
  beceYear: z.number().int().min(2000).max(2100).optional(),
  phoneE164: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  bloodType: z.string().max(10).optional(),
  medicalNotes: z.string().max(2000).optional(),
  allergies: z.string().max(1000).optional(),
  specialNeeds: z.string().max(1000).optional(),
  admissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional(),
  admissionNumber: z.string().max(50).optional(),
  previousSchool: z.string().max(255).optional(),
});

export const updateStudentSchema = createStudentSchema.partial().extend({
  id: z.string().uuid('Invalid student ID'),
});

// Guardian schemas
export const createGuardianSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  preferredName: z.string().max(100).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  nationality: z.string().length(2).optional(),
  phoneE164: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number'),
  phoneE1642: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  occupation: z.string().max(100).optional(),
  employer: z.string().max(255).optional(),
  workPhone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  nationalId: z.string().max(50).optional(),
  nationalIdType: z.string().max(50).optional(),
});

export const updateGuardianSchema = createGuardianSchema.partial().extend({
  id: z.string().uuid('Invalid guardian ID'),
});

// Guardian relationship schemas
export const createGuardianRelationshipSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
  guardianId: z.string().uuid('Invalid guardian ID'),
  relationshipType: z.enum(['FATHER', 'MOTHER', 'GRANDFATHER', 'GRANDMOTHER', 'UNCLE', 'AUNT', 'LEGAL_GUARDIAN', 'SPONSOR', 'OTHER']),
  isPrimary: z.boolean().default(false),
  isEmergency: z.boolean().default(false),
  canPickUp: z.boolean().default(true),
  paysFees: z.boolean().default(false),
  feePercentage: z.number().int().min(0).max(100).optional(),
});

export const updateGuardianRelationshipSchema = createGuardianRelationshipSchema.partial().extend({
  id: z.string().uuid('Invalid relationship ID'),
});

// Enrolment schemas
export const createEnrolmentSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
  academicYearId: z.string().uuid('Invalid academic year ID'),
  termId: z.string().uuid('Invalid term ID'),
  campusId: z.string().uuid('Invalid campus ID'),
  gradeLevel: z.string().max(50).optional(),
  section: z.string().max(10).optional(),
  enrolmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  currency: z.string().length(3).default('GHS'),
});

export const updateEnrolmentSchema = createEnrolmentSchema.partial().extend({
  id: z.string().uuid('Invalid enrolment ID'),
  gpa: z.number().min(0).max(4).optional(),
  classRank: z.number().int().positive().optional(),
  totalStudents: z.number().int().positive().optional(),
  daysPresent: z.number().int().min(0).optional(),
  daysAbsent: z.number().int().min(0).optional(),
  daysLate: z.number().int().min(0).optional(),
  feesOwed: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,4})?$/, 'Enter an amount with up to four decimal places').optional(),
  feesPaid: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,4})?$/, 'Enter an amount with up to four decimal places').optional(),
  remarks: z.string().max(2000).optional(),
});

// Query schemas
export const studentListQuerySchema = z.object({
  status: z.enum(['PROSPECTIVE', 'ENROLLED', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'DECEASED']).optional(),
  campusId: z.string().uuid().optional(),
  gradeLevel: z.string().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;
export type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>;
export type CreateGuardianRelationshipInput = z.infer<typeof createGuardianRelationshipSchema>;
export type UpdateGuardianRelationshipInput = z.infer<typeof updateGuardianRelationshipSchema>;
export type CreateEnrolmentInput = z.infer<typeof createEnrolmentSchema>;
export type UpdateEnrolmentInput = z.infer<typeof updateEnrolmentSchema>;
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
