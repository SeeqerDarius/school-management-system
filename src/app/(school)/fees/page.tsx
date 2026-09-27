import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { today } from '@/features/attendance/data';
import { RaiseInvoicesForm, RecordPaymentForm } from '@/features/fees/components/money-forms';
import {
  classesForFees,
  listInvoices,
  listPayments,
  studentsForFees,
  termsForFees,
  type InvoiceRow,
} from '@/features/fees/data';
import { formatMoney } from '@/lib/money';

export const metadata: Metadata = { title: 'Fees' };

const SETTLEMENT_TONE = {
  DRAFT: 'neutral',
  CANCELLED: 'neutral',
  UNPAID: 'danger',
  PART_PAID: 'warning',
  PAID: 'success',
} as const;

/**
 * The fee ledger.
 *
 * <p>What appears here is not the same for everybody, and the narrowing is a `where` clause
 * rather than a filter — a guardian's query never touches another family's invoice. A class
 * teacher reaches this page and sees nothing at all, which is DATA_PRIVACY §4 working rather
 * than a bug: "the class teacher must not be the person who knows which family has not paid".
 */
export default async function FeesPage() {
  const [invoices, payments, schoolToday] = await Promise.all([
    listInvoices(),
    listPayments(),
    today(),
  ]);

  if (invoices.reach === 'NONE') {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Fees" />
        <EmptyState
          title="Fees are not part of your role"
          description="Fee balances and payment history are kept to the people who collect them and to the families themselves."
        />
      </main>
    );
  }

  const isFamily = invoices.reach !== 'ALL';
  const currency = invoices.summary.currency;

  const [classes, students, terms] = invoices.canRaise
    ? await Promise.all([classesForFees(), studentsForFees(), termsForFees()])
    : [[], [], []];

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title={isFamily ? 'Fees' : 'Fees and payments'}
        description={
          isFamily
            ? 'What is owed, what has been paid, and the receipts for it.'
            : 'Invoices, receipts and balances for the whole school.'
        }
      />

      <Panel title="Where things stand">
        <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4 sm:px-5">
          <Figure label="Invoiced" value={formatMoney(invoices.summary.invoiced, currency)} />
          <Figure label="Settled" value={formatMoney(invoices.summary.settled, currency)} />
          <Figure
            label="Outstanding"
            value={formatMoney(invoices.summary.outstanding, currency)}
            emphasis
          />
          <Figure
            label="Credit on account"
            value={formatMoney(invoices.summary.creditOnAccount, currency)}
            hint="Paid, not yet claimed by an invoice"
          />
        </dl>
      </Panel>

      {invoices.canRaise && terms.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Raise a term’s invoices"
            description="One class at a time. Children who already have an invoice for the term are skipped."
          >
            <div className="px-4 py-4 sm:px-5">
              <RaiseInvoicesForm
                classes={classes.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
                terms={terms}
                defaultDue={schoolToday}
              />
            </div>
          </Panel>
        </div>
      )}

      {invoices.canRecordPayment && (
        <div className="mt-4">
          <Panel title="Record a payment">
            <div className="px-4 py-4 sm:px-5">
              <RecordPaymentForm
                students={students.map((s) => ({
                  id: s.id,
                  label: `${s.reference ?? ''} — ${[s.preferredName ?? s.firstName, s.lastName].filter(Boolean).join(' ')}`,
                }))}
                defaultDate={schoolToday}
                currency={currency}
              />
            </div>
          </Panel>
        </div>
      )}

      <div className="mt-4">
        <Panel title="Invoices" description={`${invoices.rows.length}`}>
          {invoices.rows.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              description={
                invoices.canRaise
                  ? 'Set up a price list under Fee structure, then raise a term’s invoices above.'
                  : 'Nothing has been billed yet. Invoices appear here when the school raises them.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <caption className="sr-only">Invoices</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <Th>Invoice</Th>
                    <Th>Child</Th>
                    <Th>Term</Th>
                    <Th>Total</Th>
                    <Th>Outstanding</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.rows.map((row) => (
                    <InvoiceRowView key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {payments.length > 0 && (
        <div className="mt-4">
          <Panel title="Receipts" description={`${payments.length}`}>
            <ul className="divide-y divide-[var(--color-border)]">
              {payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5">
                  <span className="font-medium tabular-nums">{payment.receiptNo ?? '—'}</span>
                  <span className="text-[var(--color-ink-muted)]">{payment.studentName}</span>
                  <span className="tabular-nums">{formatMoney(payment.amount, payment.currency)}</span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {payment.method.toLowerCase().replace('_', ' ')}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {payment.unallocated !== '0.0000' && (
                      <StatusBadge
                        label={`${formatMoney(payment.unallocated, payment.currency)} unallocated`}
                        tone="warning"
                      />
                    )}
                    {payment.status === 'REVERSED' && <StatusBadge label="Reversed" tone="danger" />}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5">
      {children}
    </th>
  );
}

function Figure({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</dt>
      <dd
        className={`mt-0.5 tabular-nums ${
          emphasis ? 'text-lg font-semibold text-[var(--color-ink)]' : 'text-sm text-[var(--color-ink)]'
        }`}
      >
        {value}
      </dd>
      {hint && <p className="text-xs text-[var(--color-ink-subtle)]">{hint}</p>}
    </div>
  );
}

function InvoiceRowView({ row }: { row: InvoiceRow }) {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <th scope="row" className="px-4 py-2 text-left font-medium sm:px-5">
        <Link href={`/fees/${row.id}`} className="text-[var(--color-primary)] hover:underline">
          {row.invoiceNo ?? 'Draft'}
        </Link>
      </th>
      <td className="px-4 py-2">
        {row.studentName}
        <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{row.reference}</span>
      </td>
      <td className="px-4 py-2 text-[var(--color-ink-muted)]">{row.termName}</td>
      <td className="px-4 py-2 tabular-nums">{formatMoney(row.total, row.currency)}</td>
      <td className="px-4 py-2 tabular-nums">{formatMoney(row.outstanding, row.currency)}</td>
      <td className="px-4 py-2 sm:px-5">
        <StatusBadge
          label={row.settlement.charAt(0) + row.settlement.slice(1).toLowerCase().replace('_', ' ')}
          tone={SETTLEMENT_TONE[row.settlement]}
        />
      </td>
    </tr>
  );
}
