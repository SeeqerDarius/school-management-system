'use server';

import { revalidatePath } from 'next/cache';

import { ATTENDANCE_PATH } from '@/features/attendance/data';
import { lockRegisterInput, saveRegisterInput, type MarkInput } from '@/features/attendance/schema';
import { rollForTerm } from '@/features/classes/data';
import { registerCapabilities, toSessionDate, type RegisterStatusName } from '@/lib/attendance';
import { P } from '@/lib/permissions';
import { recordAudit } from '@/server/audit';
import { PermissionDeniedError, requireActiveSession } from '@/server/auth/session';

/**
 * Writes for the register.
 *
 * <p>Every rule enforced here is enforced again by the database. That is not redundancy: these
 * give a person a sentence they can act on, and the triggers give the guarantee — including
 * against an import script, a console session and any code path nobody has written yet.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
}

class RuleViolation extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'RuleViolation';
  }
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

    // I-8: never swallowed into a success. A teacher who is told their register saved when it
    // did not will not come back to check.
    console.error('attendance action failed', error);
    return { ok: false, message: 'Something went wrong. No marks were changed.' };
  }
}

/**
 * Reads the mark fields out of the form, keyed by child.
 *
 * <p>Keyed rather than positional, and that is not a style choice. An unchecked radio group
 * submits **nothing at all**, so `getAll('status')` is shorter than `getAll('studentId')` the
 * moment one child is unmarked — and every mark after the gap shifts onto the wrong child. A
 * register that quietly records Ama's absence against Kojo is worse than one that fails.
 */
function marksFromForm(formData: FormData): unknown[] {
  const ids = formData.getAll('studentId').map(String);
  return ids.map((studentId) => ({
    studentId,
    status: (formData.get(`status:${studentId}`) as string | null) || null,
    minutesLate: (formData.get(`minutesLate:${studentId}`) as string | null) ?? '',
    reason: (formData.get(`note:${studentId}`) as string | null) ?? '',
  }));
}

export async function saveRegisterAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const session = await requireActiveSession();

    const parsed = saveRegisterInput.safeParse({
      classGroupId: formData.get('classGroupId'),
      sessionDate: formData.get('sessionDate'),
      marks: marksFromForm(formData),
      submit: formData.get('intent') === 'submit',
      correctionReason: formData.get('correctionReason'),
    });
    if (!parsed.success) {
      return { ok: false, message: 'That register could not be read. Nothing was changed.' };
    }

    const input = parsed.data;
    const date = toSessionDate(input.sessionDate);

    await session.transaction(async (db) => {
      const group = await db.classGroup.findFirst({
        where: { id: input.classGroupId },
        select: { id: true, code: true, classTeacherMembershipId: true },
      });
      if (!group) throw new RuleViolation('That class no longer exists.');

      const term = await db.term.findFirst({
        where: { startsOn: { lte: date }, endsOn: { gte: date } },
        select: { id: true },
      });
      if (!term) throw new RuleViolation('That day is not inside any term. No register is taken.');

      let register = await db.attendanceRegister.findFirst({
        where: { classGroupId: group.id, sessionDate: date },
        select: { id: true, status: true },
      });

      const status = (register?.status ?? 'DRAFT') as RegisterStatusName;
      const isClassTeacher = group.classTeacherMembershipId === session.membershipId;
      const can = registerCapabilities(status, session.permissions, isClassTeacher);

      if (!can.mark) {
        throw new RuleViolation(
          status === 'LOCKED'
            ? 'This register is locked. It cannot be changed by anybody.'
            : 'You may not change this register.',
        );
      }
      if (can.correcting && !input.correctionReason) {
        throw new RuleViolation(
          'This register has been submitted. Say why you are correcting it.',
          'correctionReason',
        );
      }

      if (!register) {
        register = await db.attendanceRegister.create({
          data: {
            tenantId: session.tenantId,
            classGroupId: group.id,
            termId: term.id,
            sessionDate: date,
            takenByMembershipId: session.membershipId,
          },
          select: { id: true, status: true },
        });
      }

      // Marks with no status are children the teacher has not reached yet. They are dropped
      // rather than rejected — see the schema — so a half-finished register saves.
      const marked = input.marks.filter((m): m is MarkInput & { status: NonNullable<MarkInput['status']> } =>
        m.status !== null,
      );

      for (const mark of marked) {
        const data = {
          status: mark.status,
          minutesLate: mark.status === 'LATE' ? mark.minutesLate : null,
          reason: mark.reason,
          markedByMembershipId: session.membershipId,
          ...(can.correcting
            ? {
                correctedAt: new Date(),
                correctedByMembershipId: session.membershipId,
                correctionReason: input.correctionReason,
              }
            : {}),
        };

        await db.attendanceEntry.upsert({
          where: { registerId_studentId: { registerId: register.id, studentId: mark.studentId } },
          create: { tenantId: session.tenantId, registerId: register.id, studentId: mark.studentId, ...data },
          update: data,
        });
      }

      if (input.submit) {
        // Checked here so the message can say who is missing. The database checks it again and
        // that is the one that guarantees it.
        const roll = await rollForTerm(db, group.id, term.id);
        const have = new Set(marked.map((m) => m.studentId));
        const missing = roll.filter((r) => !have.has(r.studentId));

        if (missing.length > 0) {
          const names = missing
            .slice(0, 3)
            .map((r) => [r.student.preferredName ?? r.student.firstName, r.student.lastName].join(' '))
            .join(', ');
          throw new RuleViolation(
            missing.length === 1
              ? `${names} has no mark. Every child on the roll must be accounted for before this register is submitted — your other marks have been saved.`
              : `${missing.length} children have no mark (${names}${missing.length > 3 ? ', …' : ''}). Every child must be accounted for before this register is submitted — your other marks have been saved.`,
          );
        }

        await db.attendanceRegister.update({
          where: { id: register.id },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            submittedByMembershipId: session.membershipId,
          },
        });
      }

      await recordAudit(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorMembershipId: session.membershipId,
        action: input.submit ? 'REGISTER_SUBMITTED' : can.correcting ? 'REGISTER_CORRECTED' : 'REGISTER_MARKED',
        resourceType: 'attendance_register',
        resourceId: register.id,
        resourceRef: `${group.code}/${input.sessionDate}`,
        ...(input.correctionReason ? { reason: input.correctionReason } : {}),
        after: { marked: marked.length, submitted: input.submit },
      });
    });

    revalidatePath(`${ATTENDANCE_PATH}/${input.classGroupId}`);
    revalidatePath(ATTENDANCE_PATH);
    return {
      ok: true,
      message: input.submit ? 'Register submitted.' : 'Marks saved.',
    };
  });
}

export async function lockRegisterAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const session = await requireActiveSession();
    if (!session.permissions.has(P.ATTENDANCE_LOCK)) throw new PermissionDeniedError(P.ATTENDANCE_LOCK);

    const parsed = lockRegisterInput.safeParse({
      registerId: formData.get('registerId'),
      reason: formData.get('reason'),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RuleViolation(issue?.message ?? 'Check the form.', 'reason');
    }

    const input = parsed.data;
    let classGroupId = '';

    await session.transaction(async (db) => {
      const register = await db.attendanceRegister.findFirst({
        where: { id: input.registerId },
        select: { id: true, status: true, sessionDate: true, classGroupId: true, classGroup: { select: { code: true } } },
      });
      if (!register) throw new RuleViolation('That register no longer exists.');
      if (register.status === 'LOCKED') throw new RuleViolation('That register is already locked.');
      if (register.status !== 'SUBMITTED') {
        throw new RuleViolation('A register has to be submitted before it can be locked.');
      }
      classGroupId = register.classGroupId;

      await db.attendanceRegister.update({
        where: { id: register.id },
        data: {
          status: 'LOCKED',
          lockedAt: new Date(),
          lockedByMembershipId: session.membershipId,
          lockedReason: input.reason,
        },
      });

      await recordAudit(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorMembershipId: session.membershipId,
        action: 'REGISTER_LOCKED',
        resourceType: 'attendance_register',
        resourceId: register.id,
        resourceRef: register.classGroup.code,
        reason: input.reason,
        after: { status: 'LOCKED' },
      });
    });

    if (classGroupId) revalidatePath(`${ATTENDANCE_PATH}/${classGroupId}`);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true, message: 'Register locked. It cannot be changed now, by anybody.' };
  });
}
