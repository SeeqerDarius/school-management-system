'use client';

import { useActionState } from 'react';

import { Button, CheckboxField, Field, FormMessage, SelectField, SubmitButton, TextAreaField } from '@/components/form';
import {
  activateScheduleAction,
  addScheduleLineAction,
  allocatePaymentAction,
  cancelInvoiceAction,
  createFeeItemAction,
  createScheduleAction,
  creditInvoiceAction,
  decideRefundAction,
  issueInvoiceAction,
  raiseInvoicesAction,
  recordPaymentAction,
  requestRefundAction,
  reversePaymentAction,
  type ActionResult,
} from '@/features/fees/actions';
import { PAYMENT_METHODS } from '@/features/fees/schema';

/**
 * The fee forms.
 *
 * <p>Every amount input is `type="text"` with `inputMode="decimal"`, not `type="number"`. A
 * number input hands back a value the browser has already coerced, silently drops a trailing
 * zero, and on some Android keyboards offers a scroll wheel that changes the amount when the
 * page scrolls. An amount is a string from the keyboard to the column (I-2), and the input has
 * to be one too.
 */

const METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
};

function AmountField({
  label,
  name,
  error,
  hint,
  defaultValue,
}: {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string;
  defaultValue?: string;
}) {
  return (
    <Field
      label={label}
      name={name}
      type="text"
      required
      inputMode="decimal"
      placeholder="0.00"
      defaultValue={defaultValue}
      error={error}
      hint={hint}
    />
  );
}

export function NewFeeItemForm() {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    createFeeItemAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code" name="code" required placeholder="TUITION" error={state?.fieldErrors?.['code']} />
        <Field label="Name" name="name" required placeholder="Tuition" error={state?.fieldErrors?.['name']} />
        <Field label="Description" name="description" hint="Optional" />
      </div>
      <CheckboxField
        label="Optional item"
        name="isOptional"
        hint="Offered but not billed automatically — a bus place, a club."
      />
      <div>
        <SubmitButton pendingLabel="Adding…">Add fee item</SubmitButton>
      </div>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function NewScheduleForm({
  terms,
  classes,
  defaultCurrency,
}: {
  terms: ReadonlyArray<{ id: string; label: string }>;
  classes: ReadonlyArray<{ id: string; label: string }>;
  defaultCurrency: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    createScheduleAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label="Term"
          name="termId"
          required
          placeholder="Choose a term"
          options={terms.map((term) => ({ value: term.id, label: term.label }))}
          error={state?.fieldErrors?.['termId']}
        />
        <SelectField
          label="Class"
          name="classGroupId"
          placeholder="Every class"
          options={classes.map((c) => ({ value: c.id, label: c.label }))}
          hint="A list for one class overrides the general one."
        />
        <Field label="Name" name="name" required placeholder="Term 1 fees" error={state?.fieldErrors?.['name']} />
        <Field label="Currency" name="currency" required defaultValue={defaultCurrency} error={state?.fieldErrors?.['currency']} />
      </div>
      <Field label="Effective from" name="effectiveFrom" type="date" required error={state?.fieldErrors?.['effectiveFrom']} />
      <div>
        <SubmitButton pendingLabel="Creating…">Create price list</SubmitButton>
      </div>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function AddScheduleLineForm({
  feeScheduleId,
  items,
}: {
  feeScheduleId: string;
  items: ReadonlyArray<{ id: string; label: string }>;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    addScheduleLineAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="feeScheduleId" value={feeScheduleId} />
      <div className="min-w-[12rem] flex-1">
        <SelectField
          label="Fee item"
          name="feeItemId"
          required
          placeholder="Choose an item"
          options={items.map((item) => ({ value: item.id, label: item.label }))}
          error={state?.fieldErrors?.['feeItemId']}
        />
      </div>
      <AmountField label="Amount" name="amount" error={state?.fieldErrors?.['amount']} />
      <SubmitButton pendingLabel="Saving…">Set price</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function ActivateScheduleForm({ scheduleId }: { scheduleId: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    activateScheduleAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="feeScheduleId" value={scheduleId} />
      <SubmitButton pendingLabel="Activating…">Make live</SubmitButton>
      <p className="text-xs text-[var(--color-ink-muted)]">Prices freeze once invoices can be raised from it.</p>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function RaiseInvoicesForm({
  classes,
  terms,
  defaultDue,
}: {
  classes: ReadonlyArray<{ id: string; label: string }>;
  terms: ReadonlyArray<{ id: string; label: string }>;
  defaultDue: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    raiseInvoicesAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[10rem] flex-1">
        <SelectField
          label="Class"
          name="classGroupId"
          required
          placeholder="Choose a class"
          options={classes.map((c) => ({ value: c.id, label: c.label }))}
          error={state?.fieldErrors?.['classGroupId']}
        />
      </div>
      <div className="min-w-[10rem] flex-1">
        <SelectField
          label="Term"
          name="termId"
          required
          placeholder="Choose a term"
          options={terms.map((t) => ({ value: t.id, label: t.label }))}
          error={state?.fieldErrors?.['termId']}
        />
      </div>
      <Field label="Due" name="dueOn" type="date" required defaultValue={defaultDue} error={state?.fieldErrors?.['dueOn']} />
      <SubmitButton pendingLabel="Raising…">Raise invoices</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function IssueInvoiceForm({ invoiceId, defaultDue }: { invoiceId: string; defaultDue: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    issueInvoiceAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="Due" name="dueOn" type="date" required defaultValue={defaultDue} error={state?.fieldErrors?.['dueOn']} />
      <SubmitButton pendingLabel="Issuing…">Issue</SubmitButton>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Issuing allocates the number and freezes the invoice. Reduce it afterwards with a credit note.
      </p>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function CancelInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    cancelInvoiceAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <TextAreaField label="Why it is being cancelled" name="reason" required rows={2} error={state?.fieldErrors?.['reason']} />
      <Button type="submit" variant="danger">Cancel invoice</Button>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function CreditNoteForm({ invoiceId, currency }: { invoiceId: string; currency: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    creditInvoiceAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <AmountField label={`Amount to credit (${currency})`} name="amount" error={state?.fieldErrors?.['amount']} />
      <TextAreaField
        label="Why"
        name="reason"
        required
        rows={2}
        hint="A hardship decision, a billing error, a scholarship applied late. An auditor reads this."
        error={state?.fieldErrors?.['reason']}
      />
      <SubmitButton pendingLabel="Raising…">Raise credit note</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function RecordPaymentForm({
  students,
  defaultDate,
  currency,
}: {
  students: ReadonlyArray<{ id: string; label: string }>;
  defaultDate: string;
  currency: string;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    recordPaymentAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label="Child"
          name="studentId"
          required
          placeholder="Choose a child"
          options={students.map((s) => ({ value: s.id, label: s.label }))}
          error={state?.fieldErrors?.['studentId']}
        />
        <SelectField
          label="How it arrived"
          name="method"
          required
          placeholder="Choose"
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
          error={state?.fieldErrors?.['method']}
        />
        <AmountField
          label={`Amount (${currency})`}
          name="amount"
          error={state?.fieldErrors?.['amount']}
        />
        <Field label="Received on" name="receivedOn" type="date" required defaultValue={defaultDate} error={state?.fieldErrors?.['receivedOn']} />
      </div>
      <Field
        label="Reference"
        name="reference"
        hint="The momo transaction id, cheque number or bank reference. Required for mobile money and transfers."
        error={state?.fieldErrors?.['reference']}
      />
      <CheckboxField
        label="Settle the oldest unpaid invoices with it"
        name="autoAllocate"
        defaultChecked
        hint="Anything left over stays as credit on the child's account. It is the family's money until something is raised for it to settle."
      />
      <div>
        <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
      </div>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function AllocateForm({
  paymentId,
  invoices,
}: {
  paymentId: string;
  invoices: ReadonlyArray<{ id: string; label: string }>;
}) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    allocatePaymentAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="min-w-[14rem] flex-1">
        <SelectField
          label="Invoice"
          name="invoiceId"
          required
          placeholder="Choose an invoice"
          options={invoices.map((i) => ({ value: i.id, label: i.label }))}
        />
      </div>
      <AmountField label="Amount" name="amount" error={state?.fieldErrors?.['amount']} />
      <SubmitButton pendingLabel="Allocating…">Allocate</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function ReversePaymentForm({ paymentId }: { paymentId: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    reversePaymentAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="min-w-[14rem] flex-1">
        <Field label="Why" name="reason" required placeholder="Cheque returned unpaid" error={state?.fieldErrors?.['reason']} />
      </div>
      <SubmitButton variant="danger" pendingLabel="Reversing…">Reverse</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function RequestRefundForm({ paymentId, currency }: { paymentId: string; currency: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    requestRefundAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />
      <AmountField label={`Refund (${currency})`} name="amount" error={state?.fieldErrors?.['amount']} />
      <div className="min-w-[14rem] flex-1">
        <Field label="Why" name="reason" required placeholder="Overpaid — child withdrew" error={state?.fieldErrors?.['reason']} />
      </div>
      <SubmitButton pendingLabel="Requesting…">Request refund</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}

/**
 * Deciding a refund.
 *
 * <p>Hidden from the person who requested it — but only as a courtesy. The permission check and
 * a database CHECK both refuse a self-approval, so this is saving them a click, not enforcing
 * anything.
 */
export function DecideRefundForm({ refundId }: { refundId: string }) {
  const [state, formAction] = useActionState<ActionResult | undefined, FormData>(
    decideRefundAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="refundId" value={refundId} />
      <div className="min-w-[12rem] flex-1">
        <Field label="Note" name="note" placeholder="Optional" />
      </div>
      <SubmitButton name="decision" value="APPROVED" pendingLabel="Approving…">Approve</SubmitButton>
      <SubmitButton name="decision" value="REJECTED" variant="danger" pendingLabel="Rejecting…">Reject</SubmitButton>
      {state?.message && <FormMessage message={state.message} tone={state.ok ? 'success' : 'error'} />}
    </form>
  );
}
