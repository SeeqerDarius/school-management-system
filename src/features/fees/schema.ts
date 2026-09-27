import { z } from 'zod';

/**
 * Input validation for fees, invoicing and payments.
 *
 * <p>Amounts arrive as strings and stay strings. There is no `z.coerce.number()` anywhere in this
 * file, and that is deliberate: coercing "1234.56" to a `number` at the edge undoes the whole
 * point of `src/lib/money.ts` before the value has even reached the action.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in the form YYYY-MM-DD');

/**
 * An amount, as a string.
 *
 * <p>Validated by pattern rather than by parsing, so nothing is ever turned into a `number` to
 * find out whether it is valid. Up to four decimal places, matching `numeric(19,4)`; more places
 * are refused rather than silently rounded, because a school typing a fifth place means something
 * by it and should be told the column cannot hold it.
 */
export const amountString = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'Enter an amount, such as 1250.00 (up to four decimal places)');

/**
 * The same, but a positive one — an invoice line of zero is a line nobody needs.
 *
 * <p>Tested as a string, not by parsing. `parseFloat` would answer this correctly and is still
 * the wrong tool: AGENTS.md forbids it outright for amounts, and a rule with a "but it's safe
 * here" exception is a rule that gets a second exception. Having already established the value
 * matches `digits[.digits]`, "is it greater than zero" is just "does it contain a non-zero
 * digit", which needs no arithmetic at all.
 *
 * <p>It also keeps this module free of `money.ts`, and so of the `Decimal` implementation behind
 * it — this file is imported by Client Components for the payment-method list.
 */
export const positiveAmount = amountString.refine((value) => /[1-9]/.test(value), {
  message: 'Enter an amount greater than zero',
});

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'CARD'] as const;
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];

export const createFeeItemInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Give the item a short code, such as TUITION')
    .max(32)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'Name the item, such as Tuition').max(120),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  isOptional: z.coerce.boolean().optional(),
});

export const createScheduleInput = z.object({
  termId: z.string().uuid('Choose the term this price list covers'),
  classGroupId: z.string().uuid().optional().or(z.literal('')),
  name: z.string().trim().min(1, 'Name the price list').max(120),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code, such as GHS')
    .transform((value) => value.toUpperCase()),
  effectiveFrom: isoDate,
});

export const scheduleLineInput = z.object({
  feeScheduleId: z.string().uuid(),
  feeItemId: z.string().uuid('Choose a fee item'),
  amount: positiveAmount,
  isMandatory: z.coerce.boolean().optional(),
});

/**
 * Raising invoices for a whole class at once.
 *
 * <p>A termly fee run is the actual workflow — a bursar does not raise four hundred invoices one
 * at a time — so the unit of work is the class, and the result says how many were raised and how
 * many were skipped because they already existed.
 */
export const raiseInvoicesInput = z.object({
  classGroupId: z.string().uuid('Choose a class'),
  termId: z.string().uuid('Choose a term'),
  dueOn: isoDate,
});

export const issueInvoiceInput = z.object({
  invoiceId: z.string().uuid(),
  dueOn: isoDate,
});

export const cancelInvoiceInput = z.object({
  invoiceId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(8, 'Say why this invoice is being cancelled — an auditor reads this')
    .max(500),
});

export const creditNoteInput = z.object({
  invoiceId: z.string().uuid(),
  amount: positiveAmount,
  reason: z
    .string()
    .trim()
    .min(8, 'Say why the family is being credited — a hardship decision, a billing error')
    .max(500),
});

export const recordPaymentInput = z.object({
  studentId: z.string().uuid('Choose a child'),
  payerGuardianId: z.string().uuid().optional().or(z.literal('')),
  method: z.enum(PAYMENT_METHODS, { message: 'Choose how the money arrived' }),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  amount: positiveAmount,
  receivedOn: isoDate,
  /**
   * Settle the oldest unpaid invoices first, up to the amount received.
   *
   * <p>On by default because it is what a bursar means by "this is for their fees", and the
   * remainder stays as credit on the child's account rather than being forced onto an invoice.
   */
  autoAllocate: z.coerce.boolean().optional(),
});

export const allocateInput = z.object({
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: positiveAmount,
});

export const reversePaymentInput = z.object({
  paymentId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(8, 'Say why — a bounced cheque, a reversed transfer, a duplicate receipt')
    .max(500),
});

export const requestRefundInput = z.object({
  paymentId: z.string().uuid(),
  amount: positiveAmount,
  reason: z.string().trim().min(8, 'Say why a refund is due').max(500),
});

export const decideRefundInput = z.object({
  refundId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});
