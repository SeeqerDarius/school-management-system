import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { DecideRefundForm } from '@/features/fees/components/money-forms';
import { listRefunds } from '@/features/fees/data';
import { formatMoney } from '@/lib/money';

export const metadata: Metadata = { title: 'Refunds' };

/**
 * Refunds, under maker-checker.
 *
 * <p>Spec 134. The bursar asks; somebody holding a different permission decides. The approve
 * controls are hidden from whoever raised the request — as a courtesy only, because a database
 * CHECK refuses a self-approval regardless of what this page renders.
 */
export default async function RefundsPage() {
  const refunds = await listRefunds();

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Refunds"
        description="Money going back out. Whoever asks for a refund cannot be the one who approves it."
      />

      <p className="mb-4 text-sm">
        <Link href="/fees" className="text-[var(--color-primary)] hover:underline">
          ← Fees and payments
        </Link>
      </p>

      <Panel title="Requests" description={`${refunds.rows.length}`}>
        {refunds.rows.length === 0 ? (
          <EmptyState
            title="No refund requests"
            description="A refund is raised from the receipt it reverses, on the fees page."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {refunds.rows.map((refund) => {
              const isMine = refund.requestedByMembershipId === refunds.membershipId;

              return (
                <li key={refund.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(refund.amount, refund.currency)}
                    </span>
                    <span className="text-[var(--color-ink-muted)]">
                      receipt {refund.receiptNo ?? '—'} · {refund.reference}
                    </span>
                    <StatusBadge
                      label={refund.status.charAt(0) + refund.status.slice(1).toLowerCase()}
                      tone={
                        refund.status === 'APPROVED'
                          ? 'success'
                          : refund.status === 'REJECTED'
                            ? 'danger'
                            : 'warning'
                      }
                    />
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{refund.reason}</p>

                  {refund.status === 'REQUESTED' && refunds.canDecide && !isMine && (
                    <div className="mt-3">
                      <DecideRefundForm refundId={refund.id} />
                    </div>
                  )}

                  {refund.status === 'REQUESTED' && isMine && (
                    <p className="mt-2 text-xs text-[var(--color-ink-subtle)]">
                      You raised this, so somebody else has to decide it.
                    </p>
                  )}

                  {refund.decisionNote && (
                    <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{refund.decisionNote}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </main>
  );
}
