import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { P } from '@/lib/permissions';
import { requireActiveSession } from '@/server/auth/session';
import { registersForDay, today, type RegisterSummary } from '@/features/attendance/data';
import { attendanceRate } from '@/lib/attendance';

export const metadata: Metadata = { title: 'Attendance' };

/**
 * The day's registers.
 *
 * <p>What a teacher opens first thing. The list is already narrowed to the classes they reach —
 * one class for a class teacher, the whole school for a headmaster — so there is no filtering to
 * do and nothing to hide in the template.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const guardSession = await requireActiveSession();
  if (!guardSession.permissions.has(P.ATTENDANCE_VIEW)) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Attendance" />
        <ErrorState
          title="Registers are not part of your role"
          detail="A register is taken by the person standing in front of the class. If you need to see one, ask whoever administers this school."
        />
      </main>
    );
  }

  const { date } = await searchParams;
  const schoolToday = await today();
  const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : schoolToday;

  const registers = await registersForDay(sessionDate);
  const outstanding = registers.filter((r) => r.status === 'NOT_TAKEN' || r.status === 'DRAFT');

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Attendance"
        description={
          sessionDate === schoolToday
            ? 'Today’s registers.'
            : `Registers for ${sessionDate}. Today is ${schoolToday}.`
        }
      />

      <Panel
        title={sessionDate === schoolToday ? 'Today' : sessionDate}
        description={
          registers.length === 0
            ? undefined
            : outstanding.length === 0
              ? 'Every register is in.'
              : `${outstanding.length} still to come in`
        }
        actions={
          <form className="flex items-center gap-2">
            <label htmlFor="date" className="sr-only">
              Show registers for another day
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={sessionDate}
              max={schoolToday}
              className="min-h-9 rounded-[var(--radius-control)] border
                         border-[var(--color-border-strong)] bg-[var(--color-surface)]
                         px-2.5 py-1.5 text-sm text-[var(--color-ink)]"
            />
          </form>
        }
      >
        {registers.length === 0 ? (
          <EmptyState
            title="No classes to take a register for"
            description="A register belongs to a class. Once a class exists and you are its class teacher — or you hold the school-wide attendance permissions — its register appears here each morning."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {registers.map((register) => (
              <RegisterRow key={register.classGroupId} register={register} />
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}

const STATUS_TONE = {
  NOT_TAKEN: 'danger',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  LOCKED: 'neutral',
} as const;

const STATUS_LABEL = {
  NOT_TAKEN: 'Not taken',
  DRAFT: 'In progress',
  SUBMITTED: 'Submitted',
  LOCKED: 'Locked',
} as const;

function RegisterRow({ register }: { register: RegisterSummary }) {
  const rate = attendanceRate(register.totals);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <Link
          href={`/attendance/${register.classGroupId}?date=${register.sessionDate}`}
          className="font-medium text-[var(--color-primary)] hover:underline"
        >
          {register.classCode}
        </Link>
        <span className="ml-2 text-sm text-[var(--color-ink-muted)]">{register.className}</span>
      </div>

      <div className="flex items-center gap-3 text-sm text-[var(--color-ink-muted)]">
        {/* Unmarked is shown separately from absent, always. A child nobody accounted for is
            not a child recorded as away, and a register that conflates them looks finished. */}
        {register.totals.unmarked > 0 && register.status !== 'NOT_TAKEN' && (
          <span className="text-[var(--color-danger)]">
            {register.totals.unmarked} unmarked
          </span>
        )}
        {rate !== null && <span className="tabular-nums">{rate}% present</span>}
        <span className="tabular-nums">{register.totals.roll} on roll</span>
        <StatusBadge label={STATUS_LABEL[register.status]} tone={STATUS_TONE[register.status]} />
      </div>
    </li>
  );
}
