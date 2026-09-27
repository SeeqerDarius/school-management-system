import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import {
  ActivateScheduleForm,
  AddScheduleLineForm,
  NewFeeItemForm,
  NewScheduleForm,
} from '@/features/fees/components/money-forms';
import { classesForFees, listFeeStructure, termsForFees } from '@/features/fees/data';
import { formatMoney } from '@/lib/money';
import { P } from '@/lib/permissions';
import { requireActiveSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Fee structure' };

/**
 * What the school charges.
 *
 * <p>Two levels: the catalogue of things a school charges for, and the price lists that say what
 * each costs for a given class and term. A price list freezes when it goes live — I-6, so that a
 * reprinted invoice reproduces the prices that were in force when it was raised rather than
 * today's.
 */
export default async function FeeStructurePage() {
  const session = await requireActiveSession();

  if (!session.permissions.has(P.FEES_VIEW) && !session.permissions.has(P.FEES_STRUCTURE_MANAGE)) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Fee structure" />
        <ErrorState
          title="You do not have permission to see the fee structure"
          detail="Ask whoever administers this school if you need it."
        />
      </main>
    );
  }

  const structure = await listFeeStructure();
  const classes = structure.canManage ? await classesForFees() : [];
  const terms = structure.canManage ? await termsForFees() : [];
  const tenant = await session.transaction((db) =>
    db.tenant.findFirst({ where: { id: session.tenantId }, select: { defaultCurrency: true } }),
  );

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Fee structure"
        description="What the school charges for, and what each costs this term. There is no built-in list of fee types — a school names its own."
      />

      <p className="mb-4 text-sm">
        <Link href="/fees" className="text-[var(--color-primary)] hover:underline">
          ← Fees and payments
        </Link>
      </p>

      {structure.canManage && (
        <Panel title="Add a fee item">
          <div className="px-4 py-4 sm:px-5">
            <NewFeeItemForm />
          </div>
        </Panel>
      )}

      <div className={structure.canManage ? 'mt-4' : ''}>
        <Panel title="Fee items" description={`${structure.items.length}`}>
          {structure.items.length === 0 ? (
            <EmptyState
              title="Nothing to charge for yet"
              description="Add tuition, levies, boarding — whatever this school bills. The names are yours."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {structure.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm sm:px-5">
                  <span className="font-medium">{item.code}</span>
                  <span>{item.name}</span>
                  {item.isOptional && <StatusBadge label="Optional" tone="neutral" />}
                  {!item.isActive && <StatusBadge label="Retired" tone="neutral" />}
                  {item.description && (
                    <span className="text-xs text-[var(--color-ink-muted)]">{item.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {structure.canManage && terms.length > 0 && (
        <div className="mt-4">
          <Panel title="Create a price list">
            <div className="px-4 py-4 sm:px-5">
              <NewScheduleForm
                terms={terms}
                classes={classes.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
                defaultCurrency={tenant?.defaultCurrency ?? 'GHS'}
              />
            </div>
          </Panel>
        </div>
      )}

      <div className="mt-4">
        <Panel title="Price lists" description={`${structure.schedules.length}`}>
          {structure.schedules.length === 0 ? (
            <EmptyState
              title="No price lists yet"
              description="A price list says what a class pays in a term. Invoices are raised from the live one."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {structure.schedules.map((schedule) => (
                <li key={schedule.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{schedule.name}</span>
                    <span className="text-sm text-[var(--color-ink-muted)]">
                      {schedule.termName} · {schedule.classCode ?? 'every class'}
                    </span>
                    <StatusBadge
                      label={schedule.status.charAt(0) + schedule.status.slice(1).toLowerCase()}
                      tone={
                        schedule.status === 'ACTIVE'
                          ? 'success'
                          : schedule.status === 'DRAFT'
                            ? 'warning'
                            : 'neutral'
                      }
                    />
                    <span className="ml-auto font-semibold tabular-nums">
                      {formatMoney(schedule.total, schedule.currency)}
                    </span>
                  </div>

                  {schedule.lines.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-sm text-[var(--color-ink-muted)]">
                      {schedule.lines.map((line) => (
                        <li key={line.id} className="flex gap-3">
                          <span className="min-w-[8rem]">{line.code}</span>
                          <span className="flex-1">{line.name}</span>
                          <span className="tabular-nums">
                            {formatMoney(line.amount, schedule.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {structure.canManage && schedule.status === 'DRAFT' && (
                    <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
                      <AddScheduleLineForm
                        feeScheduleId={schedule.id}
                        items={structure.items
                          .filter((item) => item.isActive)
                          .map((item) => ({ id: item.id, label: `${item.code} — ${item.name}` }))}
                      />
                      <ActivateScheduleForm scheduleId={schedule.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}
