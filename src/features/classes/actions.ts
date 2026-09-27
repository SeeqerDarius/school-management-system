'use server';

import { revalidatePath } from 'next/cache';

import { CLASSES_PATH } from '@/features/classes/data';
import {
  assignClassTeacherInput,
  createClassInput,
  endEnrolmentInput,
  enrolStudentInput,
} from '@/features/classes/schema';
import { toSessionDate } from '@/lib/attendance';
import { P } from '@/lib/permissions';
import { recordAudit } from '@/server/audit';
import { PermissionDeniedError, requirePermission } from '@/server/auth/session';

/**
 * Writes for classes and enrolment.
 *
 * <p>Two of these are authorization changes wearing ordinary clothes. Assigning a class teacher
 * decides who may take that class's register and see those children; enrolling a child decides
 * whose register they appear on. Both are audited for that reason, not because a class is
 * intrinsically sensitive.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
}

class RuleViolation extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'RuleViolation';
  }
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

async function run(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RuleViolation) {
      return {
        ok: false,
        message: error.message,
        ...(error.field ? { fieldErrors: { [error.field]: error.message } } : {}),
      };
    }
    if (error instanceof PermissionDeniedError) return { ok: false, message: error.message };

    // Never swallowed into a success. Invariant I-8: a screen that looks like it worked when
    // it did not is worse than an error, because nobody goes back to check.
    console.error('class action failed', error);
    return { ok: false, message: 'Something went wrong. Nothing was changed.' };
  }
}

export async function createClassAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const session = await requirePermission(P.CLASS_MANAGE);

    const parsed = createClassInput.safeParse({
      academicYearId: formData.get('academicYearId'),
      campusId: formData.get('campusId'),
      code: formData.get('code'),
      name: formData.get('name'),
      yearLevel: formData.get('yearLevel'),
      classTeacherMembershipId: formData.get('classTeacherMembershipId'),
    });
    if (!parsed.success) {
      return { ok: false, message: 'Check the form.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
    }

    const input = parsed.data;
    const teacherId = input.classTeacherMembershipId || null;

    await session.transaction(async (db) => {
      const clash = await db.classGroup.findFirst({
        where: { academicYearId: input.academicYearId, code: input.code },
        select: { id: true },
      });
      if (clash) {
        throw new RuleViolation(`${input.code} already exists in that academic year`, 'code');
      }

      const created = await db.classGroup.create({
        data: {
          // Passed because the type requires it, and overwritten by the scoped client.
          tenantId: session.tenantId,
          academicYearId: input.academicYearId,
          campusId: input.campusId,
          code: input.code,
          name: input.name,
          yearLevel: input.yearLevel,
          classTeacherMembershipId: teacherId,
        },
        select: { id: true, code: true },
      });

      await recordAudit(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorMembershipId: session.membershipId,
        action: 'CLASS_CREATED',
        resourceType: 'class_group',
        resourceId: created.id,
        resourceRef: created.code,
        after: { code: created.code, name: input.name, classTeacherMembershipId: teacherId },
      });
    });

    revalidatePath(CLASSES_PATH);
    return { ok: true, message: `${input.code} created.` };
  });
}

export async function assignClassTeacherAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const session = await requirePermission(P.CLASS_MANAGE);

    const parsed = assignClassTeacherInput.safeParse({
      classGroupId: formData.get('classGroupId'),
      membershipId: formData.get('membershipId'),
    });
    if (!parsed.success) {
      return { ok: false, message: 'Check the form.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
    }

    const { classGroupId } = parsed.data;
    const membershipId = parsed.data.membershipId || null;

    await session.transaction(async (db) => {
      const before = await db.classGroup.findFirst({
        where: { id: classGroupId },
        select: { id: true, code: true, classTeacherMembershipId: true },
      });
      if (!before) throw new RuleViolation('That class no longer exists.');

      await db.classGroup.update({
        where: { id: classGroupId },
        data: { classTeacherMembershipId: membershipId },
      });

      // Audited because this is an authorization change: it decides who may take this
      // register and, through it, which children somebody can see.
      await recordAudit(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorMembershipId: session.membershipId,
        action: membershipId ? 'CLASS_TEACHER_ASSIGNED' : 'CLASS_TEACHER_CLEARED',
        resourceType: 'class_group',
        resourceId: classGroupId,
        resourceRef: before.code,
        before: { classTeacherMembershipId: before.classTeacherMembershipId },
        after: { classTeacherMembershipId: membershipId },
      });
    });

    revalidatePath(CLASSES_PATH);
    revalidatePath(`${CLASSES_PATH}/${classGroupId}`);
    return { ok: true, message: membershipId ? 'Class teacher assigned.' : 'Class teacher cleared.' };
  });
}

export async function enrolStudentAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const session = await requirePermission(P.ADMISSION_ENROL);

    const parsed = enrolStudentInput.safeParse({
      classGroupId: formData.get('classGroupId'),
      termId: formData.get('termId'),
      studentId: formData.get('studentId'),
      enrolmentDate: formData.get('enrolmentDate'),
    });
    if (!parsed.success) {
      return { ok: false, message: 'Check the form.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
    }

    const input = parsed.data;

    await session.transaction(async (db) => {
      const group = await db.classGroup.findFirst({
        where: { id: input.classGroupId },
        select: { id: true, code: true, academicYearId: true, campusId: true },
      });
      if (!group) throw new RuleViolation('That class no longer exists.');

      const term = await db.term.findFirst({
        where: { id: input.termId, academicYearId: group.academicYearId },
        select: { id: true, name: true },
      });
      // The database enforces this too, through the enrolment/class year trigger. Checking here
      // as well buys a sentence a person can act on instead of a constraint name.
      if (!term) throw new RuleViolation('That term is not part of this class’s academic year.', 'termId');

      const already = await db.enrolment.findFirst({
        where: { studentId: input.studentId, termId: input.termId },
        select: { id: true },
      });
      if (already) {
        throw new RuleViolation('That child already has an enrolment for this term.', 'studentId');
      }

      const student = await db.student.findFirst({
        where: { id: input.studentId },
        select: { id: true, reference: true },
      });
      if (!student) throw new RuleViolation('That child no longer exists.', 'studentId');

      const created = await db.enrolment.create({
        data: {
          tenantId: session.tenantId,
          studentId: input.studentId,
          classId: group.id,
          academicYearId: group.academicYearId,
          termId: input.termId,
          campusId: group.campusId,
          enrolmentDate: toSessionDate(input.enrolmentDate),
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      // The admission number, never the child's name. An audit trail is read by people who do
      // not need to know which child it was to know what happened.
      await recordAudit(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorMembershipId: session.membershipId,
        action: 'STUDENT_ENROLLED',
        resourceType: 'enrolment',
        resourceId: created.id,
        resourceRef: `${group.code}/${student.reference}`,
        after: { classGroupId: group.id, termId: input.termId, enrolmentDate: input.enrolmentDate },
      });
    });

    revalidatePath(`${CLASSES_PATH}/${input.classGroupId}`);
    return { ok: true, message: 'Enrolled.' };
  });
}

export async function endEnrolmentAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const session = await requirePermission(P.ADMISSION_ENROL);

    const parsed = endEnrolmentInput.safeParse({
      enrolmentId: formData.get('enrolmentId'),
      completionDate: formData.get('completionDate'),
      status: formData.get('status'),
      remarks: formData.get('remarks'),
    });
    if (!parsed.success) {
      return { ok: false, message: 'Check the form.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
    }

    const input = parsed.data;
    let classGroupId = '';

    await session.transaction(async (db) => {
      const enrolment = await db.enrolment.findFirst({
        where: { id: input.enrolmentId },
        select: {
          id: true,
          status: true,
          classId: true,
          enrolmentDate: true,
          student: { select: { reference: true } },
          classGroup: { select: { code: true } },
        },
      });
      if (!enrolment) throw new RuleViolation('That enrolment no longer exists.');
      if (enrolment.status !== 'PENDING' && enrolment.status !== 'ACTIVE') {
        throw new RuleViolation('That enrolment has already been closed.');
      }

      const ends = toSessionDate(input.completionDate);
      if (ends < enrolment.enrolmentDate) {
        throw new RuleViolation('They cannot leave before they arrived.', 'completionDate');
      }
      classGroupId = enrolment.classId ?? '';

      await db.enrolment.update({
        where: { id: enrolment.id },
        data: { status: input.status, completionDate: ends, remarks: input.remarks },
      });

      await recordAudit(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorMembershipId: session.membershipId,
        action: 'ENROLMENT_ENDED',
        resourceType: 'enrolment',
        resourceId: enrolment.id,
        resourceRef: `${enrolment.classGroup?.code ?? '—'}/${enrolment.student.reference}`,
        reason: input.remarks,
        before: { status: enrolment.status },
        after: { status: input.status, completionDate: input.completionDate },
      });
    });

    if (classGroupId) revalidatePath(`${CLASSES_PATH}/${classGroupId}`);
    return { ok: true, message: 'Enrolment closed.' };
  });
}
