import type { Metadata } from 'next';

import { NewAcademicYearForm } from '@/features/calendar/components/new-academic-year-form';
import { NewTermForm } from '@/features/calendar/components/new-term-form';
import { YearActionBar } from '@/features/calendar/components/year-action-bar';
import { TermActionBar } from '@/features/calendar/components/term-action-bar';
import { listAcademicYears, listTerms } from '@/features/calendar/data';
import type { AcademicYear, Term } from '@/features/calendar/schema';
import { calendarTone, EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';

export const metadata: Metadata = { title: 'Academic calendar' };

/**
 * The academic calendar.
 *
 * <p>A Server Component: the data is fetched on the server with the session cookie, and only the
 * genuinely interactive parts — the forms and the action buttons — ship JavaScript. The page
 * renders nothing the API would not have let this user see, and it decides nothing: what the
 * user may do next comes from `allowedTransitions` on each record, computed server-side from the
 * same state machine the API enforces (§98).
 */
export default async function AcademicCalendarPage() {
  const years = await listAcademicYears();

  if (!years.ok) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Academic calendar" />
        <ErrorState
          title={
            years.status === 403
              ? 'You do not have permission to view the academic calendar'
              : 'The academic calendar could not be loaded'
          }
          detail={years.status === 403 ? undefined : years.error.message}
          {...(years.status >= 500 && years.error.correlationId
            ? { reference: years.error.correlationId }
            : {})}
        />
      </main>
    );
  }

  // Terms are fetched per year, in parallel rather than in sequence: a school with six years of
  // history would otherwise pay six round trips one after another.
  const termsByYear = new Map<string, Term[]>();
  await Promise.all(
    years.data.map(async (year) => {
      const terms = await listTerms(year.id);
      termsByYear.set(year.id, terms.ok ? terms.data : []);
    }),
  );

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Academic calendar"
        description="Academic years and the terms inside them. Attendance, marks, report cards and
                     invoices are all scoped to these, so the dates matter."
      />

      {years.data.length === 0 ? (
        <Panel>
          <EmptyState
            title="No academic years have been set up yet"
            description="An academic year is a named date range with terms inside it. Create the
                         current one first; you can add future years at any time."
          />
          <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
            <NewAcademicYearForm />
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          {years.data.map((year) => (
            <AcademicYearPanel
              key={year.id}
              year={year}
              terms={termsByYear.get(year.id) ?? []}
            />
          ))}

          <Panel title="Add an academic year">
            <div className="px-4 py-4 sm:px-5">
              <NewAcademicYearForm />
            </div>
          </Panel>
        </div>
      )}
    </main>
  );
}

function AcademicYearPanel({ year, terms }: { year: AcademicYear; terms: Term[] }) {
  return (
    <Panel
      title={year.name}
      description={`${formatDate(year.startsOn)} to ${formatDate(year.endsOn)} · ${year.code}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {year.current && <StatusBadge label="Current" tone="success" />}
          <StatusBadge label={statusLabel(year.status)} tone={calendarTone(year.status)} />
        </div>
      }
    >
      <div className="border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
        <YearActionBar
          id={year.id}
          status={year.status}
          current={year.current}
          allowedTransitions={year.allowedTransitions}
        />
      </div>

      {terms.length === 0 ? (
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
            <caption className="sr-only">
              Terms in {year.name}, in sequence
            </caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th scope="col" className="px-4 py-2 font-medium text-[var(--color-ink-muted)] sm:px-5">
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
                <th scope="col" className="px-4 py-2 text-right font-medium text-[var(--color-ink-muted)] sm:px-5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {terms.map((term) => (
                <tr key={term.id} className="border-b border-[var(--color-border)] last:border-0">
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
                      {term.current && <StatusBadge label="Current" tone="success" />}
                      <StatusBadge label={statusLabel(term.status)} tone={calendarTone(term.status)} />
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right sm:px-5">
                    <TermActionBar
                      id={term.id}
                      status={term.status}
                      allowedTransitions={term.allowedTransitions}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {year.status !== 'CLOSED' && (
        <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
          <NewTermForm academicYearId={year.id} />
        </div>
      )}
    </Panel>
  );
}

function statusLabel(status: 'PLANNED' | 'ACTIVE' | 'CLOSED'): string {
  switch (status) {
    case 'PLANNED':
      return 'Planned';
    case 'ACTIVE':
      return 'Active';
    case 'CLOSED':
      return 'Closed';
  }
}

/**
 * Formats an ISO date for display.
 *
 * <p>Parsed as a plain calendar date, never through `new Date(string)` — that would interpret it
 * as UTC midnight and render the previous day for anyone west of Greenwich, which is how a term
 * that starts on the 8th comes to be shown as starting on the 7th.
 */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const label = months[Number(month) - 1];
  return label ? `${Number(day)} ${label} ${year}` : isoDate;
}
