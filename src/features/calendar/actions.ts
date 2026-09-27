'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { CALENDAR_PATH } from '@/features/calendar/data';
import {
  createAcademicYearInput,
  createTermInput,
  reasonInput,
  toDate,
} from '@/features/calendar/schema';
import { canTransition, validateTermRange, validateYearRange } from '@/lib/calendar-status';
import { P } from '@/lib/permissions';
import { recordAudit } from '@/server/audit';
import { PermissionDeniedError, requirePermission } from '@/server/auth/session';

/**
 * Server actions for the academic calendar.
 *
 * <p>These are the enforcement point, not a convenience layer in front of one. Each action checks
 * its permission, re-reads the record inside a transaction, tests the state machine against what
 * the database actually holds, writes the change and the audit entry together, and only then
 * returns. Nothing submitted by the browser is trusted — not the dates, not the record id, and
 * certainly not which school the record belongs to.
 *
 * <p>The tenant filter appears in none of these queries. It is injected by the scoped client from
 * `src/server/tenant-scope.ts`, so naming another school's academic year here returns nothing
 * rather than their row.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Record<string, string>;
}

const SUCCESS: ActionResult = { ok: true };

/**
 * A rule the request broke — closing a year with an open term, dates that overlap.
 *
 * <p>Its message is written for the person who will read it. "The term ends after the academic
 * year does" is worth far more to them than "Conflict".
 */
class RuleViolation extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'RuleViolation';
  }
}

// =====================================================================================
// Academic years
// =====================================================================================

export async function createAcademicYearAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createAcademicYearInput.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    startsOn: formData.get('startsOn'),
    endsOn: formData.get('endsOn'),
  });

  if (!parsed.success) return invalid(parsed.error.issues);
  const input = parsed.data;

  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    const startsOn = toDate(input.startsOn);
    const endsOn = toDate(input.endsOn);

    const rangeError = validateYearRange(startsOn, endsOn);
    if (rangeError) throw new RuleViolation(rangeError, 'endsOn');

    await db.$transaction(async (tx) => {
      // Two ranges overlap when each starts before the other ends. The database carries an
      // exclusion constraint for this as well; the check here exists to name the year it
      // clashes with, which a constraint violation cannot.
      const clash = await tx.academicYear.findFirst({
        where: { startsOn: { lte: endsOn }, endsOn: { gte: startsOn } },
      });
      if (clash) {
        throw new RuleViolation(
          `Those dates overlap ${clash.name}. Academic years may not run at the same time.`,
          'startsOn',
        );
      }

      const year = await tx.academicYear.create({
        // tenantId is passed because the type requires it, and overwritten by the scoped client
        // regardless of what is passed — so a copied-and-pasted wrong value cannot write into
        // another school.
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          startsOn,
          endsOn,
        },
      });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'ACADEMIC_YEAR_CREATED',
        resourceType: 'AcademicYear',
        resourceId: year.id,
        resourceRef: year.code,
        after: {
          code: year.code,
          name: year.name,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          status: year.status,
        },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

export async function activateAcademicYearAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    await db.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw new RuleViolation('That academic year no longer exists.');

      if (!canTransition(year.status, 'ACTIVE')) {
        throw new RuleViolation(`A ${year.status.toLowerCase()} academic year cannot be activated.`);
      }

      await tx.academicYear.update({ where: { id }, data: { status: 'ACTIVE' } });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'ACADEMIC_YEAR_ACTIVATED',
        resourceType: 'AcademicYear',
        resourceId: year.id,
        resourceRef: year.code,
        before: { status: year.status },
        after: { status: 'ACTIVE' },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

export async function makeAcademicYearCurrentAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    await db.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw new RuleViolation('That academic year no longer exists.');

      if (year.status !== 'ACTIVE') {
        throw new RuleViolation('Only an active academic year can be made the current one.');
      }
      if (year.isCurrent) return;

      // At most one current year per school. Cleared first, then set, inside one transaction —
      // so there is no instant at which a concurrent reader sees two, or none.
      await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      await tx.academicYear.update({ where: { id }, data: { isCurrent: true } });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'ACADEMIC_YEAR_MADE_CURRENT',
        resourceType: 'AcademicYear',
        resourceId: year.id,
        resourceRef: year.code,
        after: { isCurrent: true },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

export async function closeAcademicYearAction(
  id: string,
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reasonInput.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) return invalid(parsed.error.issues);
  const { reason } = parsed.data;

  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    await db.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw new RuleViolation('That academic year no longer exists.');

      if (!canTransition(year.status, 'CLOSED')) {
        throw new RuleViolation('That academic year is already closed.');
      }

      const openTerms = await tx.term.count({
        where: { academicYearId: id, status: { not: 'CLOSED' } },
      });
      if (openTerms > 0) {
        throw new RuleViolation(
          openTerms === 1
            ? 'One term in this year is still open. Close it first.'
            : `${openTerms} terms in this year are still open. Close them first.`,
        );
      }

      await tx.academicYear.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: userId,
          // A closed year is not the year new work defaults to.
          isCurrent: false,
        },
      });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'ACADEMIC_YEAR_CLOSED',
        resourceType: 'AcademicYear',
        resourceId: year.id,
        resourceRef: year.code,
        reason,
        before: { status: year.status, isCurrent: year.isCurrent },
        after: { status: 'CLOSED', isCurrent: false },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

// =====================================================================================
// Terms
// =====================================================================================

export async function createTermAction(
  academicYearId: string,
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const reportsDueOn = formData.get('reportsDueOn');
  const parsed = createTermInput.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    startsOn: formData.get('startsOn'),
    endsOn: formData.get('endsOn'),
    // An empty date input submits "", which is neither an absent value nor a valid date.
    ...(typeof reportsDueOn === 'string' && reportsDueOn.length > 0 ? { reportsDueOn } : {}),
  });

  if (!parsed.success) return invalid(parsed.error.issues);
  const input = parsed.data;

  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    const startsOn = toDate(input.startsOn);
    const endsOn = toDate(input.endsOn);

    await db.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id: academicYearId } });
      if (!year) throw new RuleViolation('That academic year no longer exists.');
      if (year.status === 'CLOSED') {
        throw new RuleViolation('That academic year is closed. No terms can be added to it.');
      }

      const rangeError = validateTermRange(startsOn, endsOn, year);
      if (rangeError) throw new RuleViolation(rangeError, 'endsOn');

      if (input.reportsDueOn && toDate(input.reportsDueOn) < startsOn) {
        throw new RuleViolation('Reports cannot be due before the term starts.', 'reportsDueOn');
      }

      const siblings = await tx.term.findMany({
        where: { academicYearId },
        orderBy: { sequence: 'asc' },
      });

      const clash = siblings.find((term) => term.startsOn <= endsOn && term.endsOn >= startsOn);
      if (clash) {
        throw new RuleViolation(
          `Those dates overlap ${clash.name}. Terms may not overlap.`,
          'startsOn',
        );
      }

      // Sequence orders terms within their year and is what reporting joins on. It is derived
      // from the siblings read in this same transaction, so two people adding a term at once
      // cannot both be handed the same number.
      const sequence = siblings.reduce((highest, term) => Math.max(highest, term.sequence), 0) + 1;

      const term = await tx.term.create({
        data: {
          tenantId,
          academicYearId,
          sequence,
          code: input.code,
          name: input.name,
          startsOn,
          endsOn,
          reportsDueOn: input.reportsDueOn ? toDate(input.reportsDueOn) : null,
        },
      });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'TERM_CREATED',
        resourceType: 'Term',
        resourceId: term.id,
        resourceRef: `${year.code} ${term.code}`,
        after: {
          code: term.code,
          name: term.name,
          sequence: term.sequence,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

export async function activateTermAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    await db.$transaction(async (tx) => {
      const term = await tx.term.findUnique({ where: { id } });
      if (!term) throw new RuleViolation('That term no longer exists.');

      if (!canTransition(term.status, 'ACTIVE')) {
        throw new RuleViolation(`A ${term.status.toLowerCase()} term cannot be activated.`);
      }

      const year = await tx.academicYear.findUnique({ where: { id: term.academicYearId } });
      if (year?.status !== 'ACTIVE') {
        throw new RuleViolation('Activate the academic year before activating a term inside it.');
      }

      // Activating a term is also what makes it the current one. A school runs one term at a
      // time, and a separate "make current" step would only ever be forgotten — leaving marks
      // and invoices defaulting to a term that finished last April.
      await tx.term.updateMany({
        where: { academicYearId: term.academicYearId, isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.term.update({ where: { id }, data: { status: 'ACTIVE', isCurrent: true } });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'TERM_ACTIVATED',
        resourceType: 'Term',
        resourceId: term.id,
        resourceRef: `${year.code} ${term.code}`,
        before: { status: term.status, isCurrent: term.isCurrent },
        after: { status: 'ACTIVE', isCurrent: true },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

export async function closeTermAction(
  id: string,
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reasonInput.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) return invalid(parsed.error.issues);
  const { reason } = parsed.data;

  return run(async () => {
    const { db, tenantId, userId, membershipId } = await requirePermission(P.ACADEMIC_YEAR_MANAGE);

    await db.$transaction(async (tx) => {
      const term = await tx.term.findUnique({ where: { id } });
      if (!term) throw new RuleViolation('That term no longer exists.');

      if (!canTransition(term.status, 'CLOSED')) {
        throw new RuleViolation('That term is already closed.');
      }

      await tx.term.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: userId,
          isCurrent: false,
        },
      });

      await recordAudit(tx, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'TERM_CLOSED',
        resourceType: 'Term',
        resourceId: term.id,
        resourceRef: term.code,
        reason,
        before: { status: term.status, isCurrent: term.isCurrent },
        after: { status: 'CLOSED', isCurrent: false },
      });
    });

    revalidatePath(CALENDAR_PATH);
    return SUCCESS;
  });
}

// =====================================================================================
// Shared plumbing
// =====================================================================================

function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    // First message per field. Four complaints about one input helps nobody.
    if (typeof key === 'string' && !(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return { ok: false, message: 'Check the highlighted fields', fieldErrors };
}

/**
 * Turns whatever went wrong into something the form can render.
 *
 * <p>Rule violations and permission refusals are expected outcomes and are reported plainly.
 * Anything else is a genuine fault: it is logged in full on the server and reduced to one generic
 * sentence for the browser, because a stack trace or a constraint name in a form is an invitation
 * to map out the schema.
 */
async function run(operation: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await operation();
  } catch (error) {
    // `redirect()` inside a session check throws a control-flow signal Next.js must receive.
    // Swallowing it would strand a signed-out user on a page that quietly does nothing.
    if (isRedirect(error)) throw error;

    if (error instanceof RuleViolation) {
      return error.field
        ? { ok: false, message: error.message, fieldErrors: { [error.field]: error.message } }
        : { ok: false, message: error.message };
    }

    if (error instanceof PermissionDeniedError) {
      return { ok: false, message: 'You do not have permission to do this.' };
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        ok: false,
        message: 'That code is already in use. Codes must be unique.',
        fieldErrors: { code: 'Already in use' },
      };
    }

    console.error('Calendar action failed', error);
    return { ok: false, message: 'Something went wrong. Nothing was changed — please try again.' };
  }
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
