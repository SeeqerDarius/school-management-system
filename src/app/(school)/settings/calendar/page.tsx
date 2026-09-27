import type { Metadata } from 'next';

import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { NewAcademicYearForm } from '@/features/calendar/components/new-academic-year-form';
import { NewTermForm } from '@/features/calendar/components/new-term-form';
import { TermActionBar } from '@/features/calendar/components/term-action-bar';
import { YearActionBar } from '@/features/calendar/components/year-action-bar';
import {
  listAcademicYears,
  type AcademicYearWithTerms,
  type TermRecord,
} from '@/features/calendar/data';
import { allowedTransitions, statusLabel, statusTone } from '@/lib/calendar-status';
import { P } from '@/lib/permissions';
import { requireActiveSession } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Academic calendar' };

/**
 * The academic calendar.
 *
 * <p>A Server Component: the query runs on the server through the tenant-scoped client, and only
 * the genuinely interactive parts — the forms and the action buttons — ship any JavaScript.
 *
 * <p>The page decides nothing. What a user may do next comes from `allowedTransitions`, computed
 * here from the same state machine the actions enforce, so a button that is missing is a courtesy
 * and not the control. Removing one in the browser changes nothing about what the server accepts.
 */
export default async function AcademicCalendarPage() {
  // Resolved first so an absent session redirects to sign-in rather than rendering a refusal at
  // someone who simply has not signed in yet.
  const session = await requireActiveSession();

  if (!session.permissions.has(P.ACADEMIC_YEAR_VIEW)) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Academic calendar" />
        <ErrorState
          title="You do not have permission to view the academic calendar"
          detail="If you need access, ask whoever administers this school to grant it."
        />
      </main>
    );
  }

  const years = await listAcademicYears();
  const canManage = session.permissions.has(P.ACADEMIC_YEAR_MANAGE);

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Academic calendar"
        description="Academic years and the terms inside them. Attendance, marks, report cards and
                     invoices are all scoped to these, so the dates matter."
      />

      {years.length === 0 ? (
        <Panel>
          <EmptyState
            title="No academic years have been set up yet"
            description="An academic year is a named date range with terms inside it. Create the
                         current one first; you can add future years at any time."
          />
          {canManage && (
            <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
              <NewAcademicYearForm />
            </div>
          )}
        </Panel>
      ) : (
        <div className="space-y-4">
          {years.map((year) => (
            <AcademicYearPanel key={year.id} year={year} canManage={canManage} />
          ))}

          {canManage && (
            <Panel title="Add an academic year">
              <div className="px-4 py-4 sm:px-5">
                <NewAcademicYearForm />
              </div>
            </Panel>
          )}
        </div>
      )}
    </main>
  );
}

function AcademicYearPanel({
  year,
  canManage,
}: {
  year: AcademicYearWithTerms;
  canManage: boolean;
}) {
  return (
    <Panel
      title={year.name}
      description={`${formatDate(year.startsOn)} to ${formatDate(year.endsOn)} · ${year.code}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {year.isCurrent && <StatusBadge label="Current" tone="success" />}
          <StatusBadge label={statusLabel(year.status)} tone={statusTone(year.status)} />
        </div>
      }
    >
      {canManage && (
        <div className="border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
          <YearActionBar
            id={year.id}
            status={year.status}
            current={year.isCurrent}
            allowedTransitions={allowedTransitions(year.status)}
          />
        </div>
      )}

      {year.terms.length === 0 ? (
        <EmptyState
          title="No terms yet"
          description={
            year.status === 'CLOSED'
              ? 'This academic year was closed without any terms recorded.'
              : 'Add the terms for this year. They must fall inside the year’s own dates.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">Terms in {year.name}, in sequence</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th
                  scope="col"
                  className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5"
                >
                  #
                </th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                  Term
                </th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                  Dates
                </th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                  Reports due
                </th>
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)]">
                  Status
                </th>
                {canManage && (
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-medium text-[var(--color-ink-muted)] sm:px-5"
                  >
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {year.terms.map((term) => (
                <TermRow key={term.id} term={term} canManage={canManage} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && year.status !== 'CLOSED' && (
        <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
          <NewTermForm academicYearId={year.id} />
        </div>
      )}
    </Panel>
  );
}

function TermRow({ term, canManage }: { term: TermRecord; canManage: boolean }) {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="px-4 py-2 text-[var(--color-ink-subtle)] tabular-nums sm:px-5">
        {term.sequence}
      </td>
      <th scope="row" className="px-4 py-2 text-left font-medium text-[var(--color-ink)]">
        {term.name}
      </th>
      <td className="px-4 py-2 whitespace-nowrap text-[var(--color-ink-muted)]">
        {formatDate(term.startsOn)} – {formatDate(term.endsOn)}
      </td>
      <td className="px-4 py-2 whitespace-nowrap text-[var(--color-ink-muted)]">
        {term.reportsDueOn ? formatDate(term.reportsDueOn) : '—'}
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {term.isCurrent && <StatusBadge label="Current" tone="success" />}
          <StatusBadge label={statusLabel(term.status)} tone={statusTone(term.status)} />
        </div>
      </td>
      {canManage && (
        <td className="px-4 py-2 text-right sm:px-5">
          <TermActionBar
            id={term.id}
            status={term.status}
            allowedTransitions={allowedTransitions(term.status)}
          />
        </td>
      )}
    </tr>
  );
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats a calendar date for display.
 *
 * <p>Read with the UTC getters, never the local ones. A Postgres `date` arrives as midnight UTC;
 * `getDate()` on a machine west of Greenwich returns the previous day, which is how a term that
 * starts on the 8th comes to be shown as starting on the 7th.
 */
function formatDate(value: Date): string {
  const month = MONTHS[value.getUTCMonth()];
  return `${value.getUTCDate()} ${month} ${value.getUTCFullYear()}`;
}
