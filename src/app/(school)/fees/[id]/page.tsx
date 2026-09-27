import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader, Panel, StatusBadge } from '@/components/ui';
import { today } from '@/features/attendance/data';
import {
  CancelInvoiceForm,
  CreditNoteForm,
  IssueInvoiceForm,
} from '@/features/fees/components/money-forms';
import { getInvoice } from '@/features/fees/data';
import { formatMoney } from '@/lib/money';

export const metadata: Metadata = { title: 'Invoice' };

/**
 * One invoice.
 *
 * <p>A document, and it reads like one: the lines say what was charged, the credits say what was
 * taken off afterwards, and nothing rewrites anything. An issued invoice offers no edit at all —
 * the family is holding a piece of paper, and the row behind it has to keep agreeing with it
 * (I-3).
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const schoolToday = await today();

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title={invoice.invoiceNo ?? 'Draft invoice'}
        description={`${invoice.studentName} · ${invoice.reference} · ${invoice.termName}`}
      />

      <p className="mb-4 text-sm">
        <Link href="/fees" className="text-[var(--color-primary)] hover:underline">
          ← All invoices
        </Link>
      </p>

      <Panel
        title="What was charged"
        actions={
          <StatusBadge
            label={invoice.settlement.charAt(0) + invoice.settlement.slice(1).toLowerCase().replace('_', ' ')}
            tone={
              invoice.settlement === 'PAID'
                ? 'success'
                : invoice.settlement === 'PART_PAID'
                  ? 'warning'
                  : invoice.settlement === 'UNPAID'
                    ? 'danger'
                    : 'neutral'
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Invoice lines</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5">Item</th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">Qty</th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">Unit</th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-[var(--color-border)]">
                  <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">{line.description}</th>
                  <td className="px-4 py-2 tabular-nums">{line.quantity}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(line.unitAmount, invoice.currency)}</td>
                  <td className="px-4 py-2 tabular-nums sm:px-5">{formatMoney(line.lineTotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right font-medium sm:px-5">Total</td>
                <td className="px-4 py-2 font-semibold tabular-nums sm:px-5">
                  {formatMoney(invoice.total, invoice.currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-1 text-right text-[var(--color-ink-muted)] sm:px-5">Settled</td>
                <td className="px-4 py-1 tabular-nums text-[var(--color-ink-muted)] sm:px-5">
                  {formatMoney(invoice.settled, invoice.currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-1 text-right font-medium sm:px-5">Outstanding</td>
                <td className="px-4 py-1 font-semibold tabular-nums sm:px-5">
                  {formatMoney(invoice.outstanding, invoice.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {invoice.payments.length > 0 && (
        <div className="mt-4">
          <Panel title="Paid against this invoice">
            <ul className="divide-y divide-[var(--color-border)]">
              {invoice.payments.map((payment) => (
                <li key={payment.id} className="flex items-center gap-3 px-4 py-2 text-sm sm:px-5">
                  <span className="font-medium tabular-nums">{payment.receiptNo ?? '—'}</span>
                  <span className="tabular-nums">{formatMoney(payment.amount, invoice.currency)}</span>
                  <span className="ml-auto text-xs text-[var(--color-ink-muted)]">
                    {payment.receivedOn.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {invoice.credits.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Credited"
            description="An issued invoice is never edited. A credit note reduces it and says why."
          >
            <ul className="divide-y divide-[var(--color-border)]">
              {invoice.credits.map((credit) => (
                <li key={credit.id} className="px-4 py-2 text-sm sm:px-5">
                  <span className="tabular-nums font-medium">
                    {formatMoney(credit.amount, invoice.currency)}
                  </span>
                  <span className="ml-3 text-[var(--color-ink-muted)]">{credit.reason}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {invoice.status === 'DRAFT' && invoice.canIssue && (
        <div className="mt-4">
          <Panel title="Issue this invoice">
            <div className="px-4 py-4 sm:px-5">
              <IssueInvoiceForm invoiceId={invoice.id} defaultDue={schoolToday} />
            </div>
          </Panel>
        </div>
      )}

      {invoice.status === 'ISSUED' && invoice.canCredit && (
        <div className="mt-4">
          <Panel title="Raise a credit note">
            <div className="px-4 py-4 sm:px-5">
              <CreditNoteForm invoiceId={invoice.id} currency={invoice.currency} />
            </div>
          </Panel>
        </div>
      )}

      {/* Offered only while nothing has landed. The database refuses a cancellation once money
          has been allocated, so showing the form regardless would be a button whose only
          outcome is an error message — and on a fee screen that reads as the system being
          broken rather than as the rule it is. */}
      {invoice.status !== 'CANCELLED' &&
        invoice.canCancel &&
        (invoice.settlement === 'DRAFT' || invoice.settlement === 'UNPAID') && (
        <div className="mt-4">
          <Panel
            title="Cancel"
            description="Only while nothing has been paid against it. Once money has landed, use a credit note."
          >
            <div className="px-4 py-4 sm:px-5">
              <CancelInvoiceForm invoiceId={invoice.id} />
              </div>
            </Panel>
          </div>
        )}
    </main>
  );
}
