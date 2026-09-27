'use server';

import { revalidatePath } from 'next/cache';

import { FEES_PATH } from '@/features/fees/data';
import {
  allocateInput,
  cancelInvoiceInput,
  createFeeItemInput,
  createScheduleInput,
  creditNoteInput,
  decideRefundInput,
  issueInvoiceInput,
  raiseInvoicesInput,
  recordPaymentInput,
  requestRefundInput,
  reversePaymentInput,
  scheduleLineInput,
} from '@/features/fees/schema';
import { toSessionDate } from '@/lib/attendance';
import { add, amount, compare, isPositive, min, multiplyByQuantity, subtract, ZERO } from '@/lib/money';
import { P } from '@/lib/permissions';
import { recordAudit } from '@/server/audit';
import { PermissionDeniedError, requirePermission } from '@/server/auth/session';
import { inTenantTransaction, type TenantTx } from '@/server/tenant-scope';

/**
 * Writes for fees, invoicing and payments.
 *
 * <p>Every amount in this file is a string from the form to the column. Nothing is parsed into a
 * `number` on the way, and the arithmetic goes through `src/lib/money.ts` (I-2).
 *
 * <p>The two worth reading closely are {@link raiseInvoicesAction} — which decides what a child
 * is charged — and {@link recordPaymentAction}, which decides what a payment settles. Both are
 * places where being slightly wrong produces a plausible number rather than an error.
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

/** The database guards raise 23514 with messages written to be read. Surfaced, not swallowed. */
const GUARD =
  /an issued invoice|a cancelled invoice|a recorded payment|a reversed payment|does not add up|only an issued invoice|cannot be cancelled|different children|allocated from it|applied to it|invoice's currency|a payment is never deleted|cannot go back to draft|lines of an issued invoice/;

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

    const message = error instanceof Error ? error.message : '';
    const guard = GUARD.exec(message);
    if (guard) {
      console.warn('fees refused by a database guard', message);
      return { ok: false, message: `The database refused this: ${guard[0]}.` };
    }

    // I-8. Never swallowed into a success — and the detail stays in the log, because a fee
    // error can carry a family's name and what they owe.
    console.error('fee action failed', error);
    return { ok: false, message: 'Something went wrong. Nothing was changed.' };
  }
}

/** Allocates the next human-facing reference, in the same transaction as the document. */
async function nextReference(db: TenantTx, scope: string): Promise<string> {
  const [row] = await db.$queryRaw<{ next_reference: string }[]>`
    SELECT app.next_reference(${scope}, ${String(new Date().getUTCFullYear())}) AS next_reference
  `;
  if (!row) throw new Error(`reference allocation returned nothing for ${scope}`);
  return row.next_reference;
}

// =====================================================================================
// Fee structure
// =====================================================================================

export async function createFeeItemAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createFeeItemInput.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    isOptional: formData.get('isOptional') === 'on',
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.FEES_STRUCTURE_MANAGE);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const clash = await db.feeItem.findFirst({ where: { code: input.code }, select: { id: true } });
      if (clash) throw new RuleViolation(`${input.code} already exists.`, 'code');

      const item = await db.feeItem.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          description: input.description || null,
          isOptional: Boolean(input.isOptional),
        },
        select: { id: true, code: true },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'FEE_ITEM_CREATED',
        resourceType: 'FeeItem',
        resourceId: item.id,
        resourceRef: item.code,
        after: { code: item.code, name: input.name },
      });
    });

    revalidatePath(`${FEES_PATH}/structure`);
    return { ok: true, message: `${input.code} added.` };
  });
}

export async function createScheduleAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createScheduleInput.safeParse({
    termId: formData.get('termId'),
    classGroupId: formData.get('classGroupId') ?? '',
    name: formData.get('name'),
    currency: formData.get('currency'),
    effectiveFrom: formData.get('effectiveFrom'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.FEES_STRUCTURE_MANAGE);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const term = await db.term.findFirst({
        where: { id: input.termId },
        select: { id: true, name: true, academicYearId: true },
      });
      if (!term) throw new RuleViolation('That term is not this school’s.', 'termId');

      if (input.classGroupId) {
        const classGroup = await db.classGroup.findFirst({
          where: { id: input.classGroupId },
          select: { id: true },
        });
        if (!classGroup) throw new RuleViolation('That class is not this school’s.', 'classGroupId');
      }

      const schedule = await db.feeSchedule.create({
        data: {
          tenantId,
          academicYearId: term.academicYearId,
          termId: term.id,
          classGroupId: input.classGroupId || null,
          name: input.name,
          currency: input.currency,
          effectiveFrom: toSessionDate(input.effectiveFrom),
        },
        select: { id: true, name: true },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'FEE_SCHEDULE_CREATED',
        resourceType: 'FeeSchedule',
        resourceId: schedule.id,
        resourceRef: schedule.name,
        after: { term: term.name, currency: input.currency, status: 'DRAFT' },
      });
    });

    revalidatePath(`${FEES_PATH}/structure`);
    return { ok: true, message: `${input.name} created as a draft.` };
  });
}

export async function addScheduleLineAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = scheduleLineInput.safeParse({
    feeScheduleId: formData.get('feeScheduleId'),
    feeItemId: formData.get('feeItemId'),
    amount: formData.get('amount'),
    isMandatory: formData.get('isMandatory') !== 'off',
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.FEES_STRUCTURE_MANAGE);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const schedule = await db.feeSchedule.findFirst({
        where: { id: input.feeScheduleId },
        select: { id: true, status: true, name: true },
      });
      if (!schedule) throw new RuleViolation('That price list is not this school’s.');
      if (schedule.status !== 'DRAFT') {
        // I-6. Invoices have been raised from an active schedule; changing its prices would
        // make it disagree with every invoice already sent. Supersede it instead.
        throw new RuleViolation(
          'That price list is no longer a draft. Create a new one rather than changing prices invoices have already been raised from.',
        );
      }

      const item = await db.feeItem.findFirst({
        where: { id: input.feeItemId },
        select: { id: true, code: true },
      });
      if (!item) throw new RuleViolation('That fee item is not this school’s.', 'feeItemId');

      await db.feeScheduleLine.upsert({
        where: { feeScheduleId_feeItemId: { feeScheduleId: schedule.id, feeItemId: item.id } },
        create: {
          tenantId,
          feeScheduleId: schedule.id,
          feeItemId: item.id,
          amount: input.amount,
          isMandatory: input.isMandatory !== false,
        },
        update: { amount: input.amount, isMandatory: input.isMandatory !== false },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'FEE_SCHEDULE_LINE_SET',
        resourceType: 'FeeSchedule',
        resourceId: schedule.id,
        resourceRef: schedule.name,
        after: { item: item.code, amount: input.amount },
      });
    });

    revalidatePath(`${FEES_PATH}/structure`);
    return { ok: true, message: 'Price set.' };
  });
}

/** Freezes a price list so invoices can be raised from it. */
export async function activateScheduleAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const scheduleId = String(formData.get('feeScheduleId') ?? '');

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.FEES_STRUCTURE_MANAGE);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const schedule = await db.feeSchedule.findFirst({
        where: { id: scheduleId },
        select: { id: true, name: true, status: true, termId: true, classGroupId: true, _count: { select: { lines: true } } },
      });
      if (!schedule) throw new RuleViolation('That price list is not this school’s.');
      if (schedule.status !== 'DRAFT') throw new RuleViolation('That price list is not a draft.');
      if (schedule._count.lines === 0) {
        throw new RuleViolation('A price list with no prices on it would raise empty invoices.');
      }

      // Supersede whatever it replaces, in the same transaction — the partial unique index
      // refuses two active schedules for the same class and term, so this is not optional.
      await db.feeSchedule.updateMany({
        where: {
          termId: schedule.termId,
          classGroupId: schedule.classGroupId,
          status: 'ACTIVE',
        },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });

      await db.feeSchedule.update({
        where: { id: schedule.id },
        data: { status: 'ACTIVE', activatedAt: new Date() },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'FEE_SCHEDULE_ACTIVATED',
        resourceType: 'FeeSchedule',
        resourceId: schedule.id,
        resourceRef: schedule.name,
        before: { status: 'DRAFT' },
        after: { status: 'ACTIVE' },
      });
    });

    revalidatePath(`${FEES_PATH}/structure`);
    return { ok: true, message: 'Price list is live. Its prices are now frozen.' };
  });
}

// =====================================================================================
// Invoicing
// =====================================================================================

/**
 * Raises a term's invoices for a class.
 *
 * <p>The termly fee run — a bursar does not raise four hundred invoices one at a time. Children
 * who already have a live invoice for the term are skipped rather than billed twice, and the
 * result says how many of each, because "raised 38, skipped 2" is a sentence a bursar can act on
 * and "done" is not.
 *
 * <p>The class's own price list wins over the school-wide one. Both are resolved once, here, so a
 * child cannot be billed from a schedule that was activated halfway through the run.
 */
export async function raiseInvoicesAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = raiseInvoicesInput.safeParse({
    classGroupId: formData.get('classGroupId'),
    termId: formData.get('termId'),
    dueOn: formData.get('dueOn'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.INVOICE_CREATE);

    const outcome = await inTenantTransaction({ tenantId, userId }, async (db) => {
      const term = await db.term.findFirst({
        where: { id: input.termId },
        select: { id: true, name: true, academicYearId: true, startsOn: true, endsOn: true },
      });
      if (!term) throw new RuleViolation('That term is not this school’s.', 'termId');

      const classGroup = await db.classGroup.findFirst({
        where: { id: input.classGroupId },
        select: { id: true, code: true },
      });
      if (!classGroup) throw new RuleViolation('That class is not this school’s.', 'classGroupId');

      // The class's own list first, the general one second. Ordering by classGroupId with
      // nulls last expresses "specific beats general" in the query rather than in a comparison
      // afterwards, so there is one place the precedence is decided.
      const schedules = await db.feeSchedule.findMany({
        where: {
          termId: term.id,
          status: 'ACTIVE',
          OR: [{ classGroupId: classGroup.id }, { classGroupId: null }],
        },
        orderBy: { classGroupId: { sort: 'desc', nulls: 'last' } },
        select: {
          id: true,
          currency: true,
          lines: {
            where: { isMandatory: true },
            select: { amount: true, feeItem: { select: { id: true, name: true, isActive: true } } },
          },
        },
      });

      const schedule = schedules[0];
      if (!schedule) {
        throw new RuleViolation(
          `No live price list covers ${term.name} for ${classGroup.code}. Activate one first.`,
        );
      }

      const billable = schedule.lines.filter((line) => line.feeItem.isActive);
      if (billable.length === 0) {
        throw new RuleViolation('That price list has no active items on it.');
      }

      // Enrolment belongs to a term on this schema rather than to a date range, so "who is on
      // the roll for this term" is the enrolment row itself — the same set the attendance
      // completeness trigger counts, so a fee run and a register agree about who is in the class.
      const roll = await db.enrolment.findMany({
        where: {
          classId: classGroup.id,
          termId: term.id,
          status: { in: ['PENDING', 'ACTIVE'] },
        },
        select: { studentId: true },
      });

      let raised = 0;
      let skipped = 0;

      for (const enrolment of roll) {
        const existing = await db.invoice.findFirst({
          where: { studentId: enrolment.studentId, termId: term.id, status: { not: 'CANCELLED' } },
          select: { id: true },
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        const lines = billable.map((line) => {
          const unit = amount(String(line.amount));
          return {
            feeItemId: line.feeItem.id,
            // Snapshotted (I-6). Renaming the item next year must not rewrite this invoice.
            description: line.feeItem.name,
            quantity: 1,
            unitAmount: unit,
            discount: ZERO,
            lineTotal: multiplyByQuantity(unit, 1),
          };
        });

        const subtotal = add(...lines.map((line) => line.lineTotal));

        const invoice = await db.invoice.create({
          data: {
            tenantId,
            studentId: enrolment.studentId,
            academicYearId: term.academicYearId,
            termId: term.id,
            feeScheduleId: schedule.id,
            currency: schedule.currency,
            dueOn: toSessionDate(input.dueOn),
            subtotal,
            discountTotal: ZERO,
            total: subtotal,
            // No `tenantId` on the nested lines: `invoice_line` reaches `invoice` through the
            // composite relation (invoiceId, tenantId), so Prisma fills BOTH columns from the
            // parent and rejects the field as unknown if it is passed. That is the composite
            // key doing its job — a line cannot name a tenant its invoice does not have.
            lines: { create: lines },
          },
          select: { id: true },
        });

        raised += 1;
        void invoice;
      }

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'INVOICES_RAISED',
        resourceType: 'ClassGroup',
        resourceId: classGroup.id,
        resourceRef: `${classGroup.code} ${term.name}`,
        after: { raised, skipped, feeScheduleId: schedule.id },
      });

      return { raised, skipped };
    });

    revalidatePath(FEES_PATH);
    return {
      ok: true,
      message:
        outcome.raised === 0
          ? `Nothing raised — all ${outcome.skipped} already had an invoice for this term.`
          : `Raised ${outcome.raised} draft invoice${outcome.raised === 1 ? '' : 's'}${
              outcome.skipped > 0 ? `, skipped ${outcome.skipped} that already had one` : ''
            }.`,
    };
  });
}

/**
 * Issues a draft invoice.
 *
 * <p>The point of no return. The number is allocated here rather than at creation, so a draft
 * that is never issued does not consume one out of a sequence an auditor reads as contiguous —
 * and from here the invoice is immutable (I-3), enforced by a trigger as well as by this code.
 */
export async function issueInvoiceAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = issueInvoiceInput.safeParse({
    invoiceId: formData.get('invoiceId'),
    dueOn: formData.get('dueOn'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.INVOICE_CREATE);

    const invoiceNo = await inTenantTransaction({ tenantId, userId }, async (db) => {
      const invoice = await db.invoice.findFirst({
        where: { id: input.invoiceId },
        select: {
          id: true,
          status: true,
          total: true,
          currency: true,
          student: { select: { reference: true } },
          _count: { select: { lines: true } },
        },
      });
      if (!invoice) throw new RuleViolation('That invoice is not this school’s.');
      if (invoice.status !== 'DRAFT') throw new RuleViolation('That invoice has already been issued.');
      if (invoice._count.lines === 0) {
        throw new RuleViolation('An invoice with no lines on it says nothing. Add at least one.');
      }

      const reference = await nextReference(db, 'INV');

      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'ISSUED',
          invoiceNo: reference,
          issuedOn: new Date(),
          dueOn: toSessionDate(input.dueOn),
        },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'INVOICE_ISSUED',
        resourceType: 'Invoice',
        resourceId: invoice.id,
        resourceRef: reference,
        // The admission number and the amount. Never the child's name (§4.2).
        after: {
          reference: invoice.student.reference,
          total: amount(String(invoice.total)),
          currency: invoice.currency,
        },
      });

      return reference;
    });

    revalidatePath(FEES_PATH);
    return { ok: true, message: `Issued as ${invoiceNo}. It can no longer be edited.` };
  });
}

export async function cancelInvoiceAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = cancelInvoiceInput.safeParse({
    invoiceId: formData.get('invoiceId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.INVOICE_CANCEL);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const invoice = await db.invoice.findFirst({
        where: { id: input.invoiceId },
        select: { id: true, status: true, invoiceNo: true },
      });
      if (!invoice) throw new RuleViolation('That invoice is not this school’s.');
      if (invoice.status === 'CANCELLED') throw new RuleViolation('That invoice is already cancelled.');

      // The trigger refuses this when money has been allocated. Reached for rather than
      // re-counted here, so the application and the database cannot disagree about when an
      // invoice is past cancelling.
      await db.invoice.update({
        where: { id: invoice.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: input.reason },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'INVOICE_CANCELLED',
        resourceType: 'Invoice',
        resourceId: invoice.id,
        resourceRef: invoice.invoiceNo ?? invoice.id,
        reason: input.reason,
        before: { status: invoice.status },
        after: { status: 'CANCELLED' },
      });
    });

    revalidatePath(FEES_PATH);
    return { ok: true, message: 'Cancelled.' };
  });
}

/**
 * Credits an issued invoice.
 *
 * <p>The correction path I-3 requires. The original invoice stays exactly as the family received
 * it and a second document reduces it, so the paper in their hand and the row in the database
 * still agree — which an edit would break silently.
 */
export async function creditInvoiceAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = creditNoteInput.safeParse({
    invoiceId: formData.get('invoiceId'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.FEES_WAIVE);

    const reference = await inTenantTransaction({ tenantId, userId }, async (db) => {
      const invoice = await db.invoice.findFirst({
        where: { id: input.invoiceId },
        select: { id: true, invoiceNo: true, currency: true, status: true },
      });
      if (!invoice) throw new RuleViolation('That invoice is not this school’s.');

      const creditNoteNo = await nextReference(db, 'CRN');

      await db.creditNote.create({
        data: {
          tenantId,
          creditNoteNo,
          invoiceId: invoice.id,
          amount: input.amount,
          currency: invoice.currency,
          reason: input.reason,
          issuedOn: new Date(),
          issuedByMembershipId: membershipId,
        },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'CREDIT_NOTE_ISSUED',
        resourceType: 'CreditNote',
        resourceId: invoice.id,
        resourceRef: creditNoteNo,
        reason: input.reason,
        after: { invoiceNo: invoice.invoiceNo, amount: input.amount, currency: invoice.currency },
      });

      return creditNoteNo;
    });

    revalidatePath(FEES_PATH);
    return { ok: true, message: `Credit note ${reference} raised.` };
  });
}

// =====================================================================================
// Payments
// =====================================================================================

/**
 * Records money received, and optionally settles the oldest invoices with it.
 *
 * <p>A payment is money, not "a payment of an invoice" — see the note on the model. What it
 * settles is decided here, oldest first, and anything left over stays unallocated as credit on
 * the child's account. Forcing the remainder onto an invoice would be the school helping itself
 * to money that is still the family's.
 */
export async function recordPaymentAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = recordPaymentInput.safeParse({
    studentId: formData.get('studentId'),
    payerGuardianId: formData.get('payerGuardianId') ?? '',
    method: formData.get('method'),
    reference: formData.get('reference') ?? '',
    amount: formData.get('amount'),
    receivedOn: formData.get('receivedOn'),
    autoAllocate: formData.get('autoAllocate') !== 'off',
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.PAYMENT_RECORD);

    const outcome = await inTenantTransaction({ tenantId, userId }, async (db) => {
      const student = await db.student.findFirst({
        where: { id: input.studentId },
        select: { id: true, reference: true },
      });
      if (!student) throw new RuleViolation('That child is not on this school’s roll.', 'studentId');

      const tenant = await db.tenant.findFirst({
        where: { id: tenantId },
        select: { defaultCurrency: true },
      });
      const currency = tenant?.defaultCurrency ?? 'GHS';

      if (input.payerGuardianId) {
        const payer = await db.guardian.findFirst({
          where: { id: input.payerGuardianId },
          select: { id: true },
        });
        if (!payer) throw new RuleViolation('That guardian is not this school’s.', 'payerGuardianId');
      }

      const receiptNo = await nextReference(db, 'RCT');

      const payment = await db.payment.create({
        data: {
          tenantId,
          receiptNo,
          studentId: student.id,
          payerGuardianId: input.payerGuardianId || null,
          method: input.method,
          reference: input.reference || null,
          amount: input.amount,
          currency,
          receivedOn: toSessionDate(input.receivedOn),
          receivedByMembershipId: membershipId,
        },
        select: { id: true },
      });

      let remaining = amount(input.amount);
      const settled: Array<{ invoiceId: string; amount: string }> = [];

      if (input.autoAllocate !== false) {
        const open = await db.invoice.findMany({
          where: { studentId: student.id, status: 'ISSUED', currency },
          orderBy: [{ issuedOn: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            total: true,
            allocations: { select: { amount: true } },
            creditNotes: { select: { amount: true } },
          },
        });

        for (const invoice of open) {
          if (!isPositive(remaining)) break;

          const already = [
            ...invoice.allocations.map((a) => amount(String(a.amount))),
            ...invoice.creditNotes.map((c) => amount(String(c.amount))),
          ];
          const outstanding = subtract(
            amount(String(invoice.total)),
            already.length === 0 ? ZERO : add(...already),
          );
          if (!isPositive(outstanding)) continue;

          // Never more than is owed and never more than is left: the database refuses both,
          // and taking the smaller of the two here is what makes a partial payment land on the
          // oldest invoice rather than failing the whole transaction.
          const toApply = min(outstanding, remaining);

          await db.paymentAllocation.create({
            data: { tenantId, paymentId: payment.id, invoiceId: invoice.id, amount: toApply },
          });

          settled.push({ invoiceId: invoice.id, amount: toApply });
          remaining = subtract(remaining, toApply);
        }
      }

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'PAYMENT_RECORDED',
        resourceType: 'Payment',
        resourceId: payment.id,
        resourceRef: receiptNo,
        after: {
          reference: student.reference,
          amount: amount(input.amount),
          currency,
          method: input.method,
          allocations: settled.length,
          unallocated: remaining,
        },
      });

      return { receiptNo, settled: settled.length, remaining, currency };
    });

    revalidatePath(FEES_PATH);
    return {
      ok: true,
      message: `Receipt ${outcome.receiptNo}. ${
        outcome.settled === 0
          ? 'Held as credit on the account.'
          : `Settled ${outcome.settled} invoice${outcome.settled === 1 ? '' : 's'}${
              isPositive(outcome.remaining)
                ? `; ${outcome.remaining} left as credit on the account.`
                : '.'
            }`
      }`,
    };
  });
}

export async function allocatePaymentAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = allocateInput.safeParse({
    paymentId: formData.get('paymentId'),
    invoiceId: formData.get('invoiceId'),
    amount: formData.get('amount'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.PAYMENT_ALLOCATE);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const payment = await db.payment.findFirst({
        where: { id: input.paymentId },
        select: { id: true, receiptNo: true, amount: true, allocations: { select: { amount: true } } },
      });
      if (!payment) throw new RuleViolation('That payment is not this school’s.');

      const allocated =
        payment.allocations.length === 0
          ? ZERO
          : add(...payment.allocations.map((a) => amount(String(a.amount))));
      const spare = subtract(amount(String(payment.amount)), allocated);

      if (compare(input.amount, spare) > 0) {
        throw new RuleViolation(
          `Only ${spare} of that receipt is unallocated.`,
          'amount',
        );
      }

      await db.paymentAllocation.upsert({
        where: {
          paymentId_invoiceId: { paymentId: payment.id, invoiceId: input.invoiceId },
        },
        create: {
          tenantId,
          paymentId: payment.id,
          invoiceId: input.invoiceId,
          amount: input.amount,
        },
        update: { amount: input.amount },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'PAYMENT_ALLOCATED',
        resourceType: 'Payment',
        resourceId: payment.id,
        resourceRef: payment.receiptNo ?? payment.id,
        after: { invoiceId: input.invoiceId, amount: amount(input.amount) },
      });
    });

    revalidatePath(FEES_PATH);
    return { ok: true, message: 'Allocated.' };
  });
}

export async function reversePaymentAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reversePaymentInput.safeParse({
    paymentId: formData.get('paymentId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.PAYMENT_RECORD);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const payment = await db.payment.findFirst({
        where: { id: input.paymentId },
        select: { id: true, receiptNo: true, status: true },
      });
      if (!payment) throw new RuleViolation('That payment is not this school’s.');
      if (payment.status === 'REVERSED') throw new RuleViolation('That payment is already reversed.');

      // The allocations go first. A reversed payment that still settles invoices would leave
      // the school's receivables showing money it no longer has.
      await db.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });

      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedReason: input.reason },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'PAYMENT_REVERSED',
        resourceType: 'Payment',
        resourceId: payment.id,
        resourceRef: payment.receiptNo ?? payment.id,
        reason: input.reason,
        before: { status: 'RECORDED' },
        after: { status: 'REVERSED' },
      });
    });

    revalidatePath(FEES_PATH);
    return { ok: true, message: 'Reversed. Anything it was settling is outstanding again.' };
  });
}

// =====================================================================================
// Refunds — maker-checker
// =====================================================================================

export async function requestRefundAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = requestRefundInput.safeParse({
    paymentId: formData.get('paymentId'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.PAYMENT_REFUND);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const payment = await db.payment.findFirst({
        where: { id: input.paymentId },
        select: { id: true, receiptNo: true, amount: true, currency: true, status: true },
      });
      if (!payment) throw new RuleViolation('That payment is not this school’s.');
      if (payment.status !== 'RECORDED') throw new RuleViolation('That payment has been reversed.');
      if (compare(input.amount, amount(String(payment.amount))) > 0) {
        throw new RuleViolation('A refund cannot exceed the payment.', 'amount');
      }

      const refund = await db.refund.create({
        data: {
          tenantId,
          paymentId: payment.id,
          amount: input.amount,
          currency: payment.currency,
          reason: input.reason,
          requestedByMembershipId: membershipId,
        },
        select: { id: true },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: 'REFUND_REQUESTED',
        resourceType: 'Refund',
        resourceId: refund.id,
        resourceRef: payment.receiptNo ?? payment.id,
        reason: input.reason,
        after: { amount: amount(input.amount), currency: payment.currency, status: 'REQUESTED' },
      });
    });

    revalidatePath(`${FEES_PATH}/refunds`);
    return { ok: true, message: 'Refund requested. Somebody else has to approve it.' };
  });
}

/**
 * Approves or rejects a refund.
 *
 * <p>Maker-checker (spec 134). The permission is a different one from the request, and the
 * database additionally refuses a decision by the membership that asked — so this holding the
 * wrong check would still not let one person pay themselves.
 */
export async function decideRefundAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = decideRefundInput.safeParse({
    refundId: formData.get('refundId'),
    decision: formData.get('decision'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  return run(async () => {
    const { tenantId, userId, membershipId } = await requirePermission(P.PAYMENT_REFUND_APPROVE);

    await inTenantTransaction({ tenantId, userId }, async (db) => {
      const refund = await db.refund.findFirst({
        where: { id: input.refundId },
        select: { id: true, status: true, amount: true, currency: true, requestedByMembershipId: true },
      });
      if (!refund) throw new RuleViolation('That refund request is not this school’s.');
      if (refund.status !== 'REQUESTED') throw new RuleViolation('That request has already been decided.');

      if (refund.requestedByMembershipId === membershipId) {
        // The database says this too, as a CHECK. Said here as well so the person gets a
        // sentence rather than a constraint name — and so the rule is visible at the place a
        // reader looks for it.
        throw new RuleViolation(
          'You asked for this refund, so you cannot approve it. That is the point of the two permissions.',
        );
      }

      await db.refund.update({
        where: { id: refund.id },
        data: {
          status: input.decision,
          decidedByMembershipId: membershipId,
          decidedAt: new Date(),
          decisionNote: input.note || null,
        },
      });

      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        action: input.decision === 'APPROVED' ? 'REFUND_APPROVED' : 'REFUND_REJECTED',
        resourceType: 'Refund',
        resourceId: refund.id,
        ...(input.note ? { reason: input.note } : {}),
        before: { status: 'REQUESTED', requestedByMembershipId: refund.requestedByMembershipId },
        after: { status: input.decision, decidedByMembershipId: membershipId },
      });
    });

    revalidatePath(`${FEES_PATH}/refunds`);
    return {
      ok: true,
      message:
        input.decision === 'APPROVED'
          ? 'Approved. Paying the money out is a treasury step the ledger module will carry.'
          : 'Rejected.',
    };
  });
}
