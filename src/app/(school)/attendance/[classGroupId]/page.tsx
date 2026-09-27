import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { getRegister, today } from '@/features/attendance/data';
import { LockRegisterForm } from '@/features/attendance/components/lock-register-form';
import { RegisterForm } from '@/features/attendance/components/register-form';
import { attendanceRate } from '@/lib/attendance';

export const metadata: Metadata = { title: 'Register' };

/**
 * One class, one day.
 *
 * <p>Laid out for a phone held in one hand — the register is taken standing up, in front of the
 * children, and `TESTING.md` names 375px as the width that matters.
 */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ classGroupId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { classGroupId } = await params;
  const { date } = await searchParams;
  const schoolToday = await today();
  const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : schoolToday;

  const register = await getRegister(classGroupId, sessionDate);
  if (!register) notFound();

  const rate = attendanceRate(register.totals);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`${register.classCode} — ${sessionDate}`}
        description={register.className}
      />

      <p className="mb-4 text-sm">
        <Link href="/attendance" className="text-[var(--color-primary)] hover:underline">
          ← All registers
        </Link>
      </p>

      {sessionDate > schoolToday && (
        <ErrorState
          title="That day has not happened yet"
          detail="A register can only be taken for a day that has been. The database refuses a future one outright."
        />
      )}

      {register.outsideYear && (
        <ErrorState
          title={`${sessionDate} is outside ${register.yearName}`}
          detail="This class runs in one academic year, and a register has to fall inside it. Pick a date within the year, or take the register on the class that covers this date."
        />
      )}

      {sessionDate <= schoolToday && !register.outsideYear && (
        <Panel
          title="Register"
          description={
            register.lines.length === 0
              ? undefined
              : `${register.totals.roll} on roll${rate === null ? '' : ` · ${rate}% present`}${
                  register.totals.unmarked > 0 ? ` · ${register.totals.unmarked} unmarked` : ''
                }`
          }
          actions={
            <StatusBadge
              label={
                register.status === 'NOT_TAKEN'
                  ? 'Not taken'
                  : register.status === 'DRAFT'
                    ? 'In progress'
                    : register.status === 'SUBMITTED'
                      ? 'Submitted'
                      : 'Locked'
              }
              tone={
                register.status === 'NOT_TAKEN'
                  ? 'danger'
                  : register.status === 'DRAFT'
                    ? 'warning'
                    : register.status === 'SUBMITTED'
                      ? 'success'
                      : 'neutral'
              }
            />
          }
        >
          <div className="px-4 py-3 sm:px-5">
            {register.lines.length === 0 ? (
              <EmptyState
                title="Nobody is on this roll for that day"
                description="A register is taken against the children enrolled in the class on the day. Enrol children into this class and the register will have rows."
              />
            ) : (
              <RegisterForm
                classGroupId={register.classGroupId}
                sessionDate={sessionDate}
                lines={register.lines}
                capabilities={register.capabilities}
                status={register.status}
              />
            )}
          </div>
        </Panel>
      )}

      {register.capabilities.lock && register.registerId && (
        <div className="mt-4">
          <Panel
            title="Lock this register"
            description="Final. Nothing can change it afterwards — not a correction, not an administrator."
          >
            <div className="px-4 py-4 sm:px-5">
              <LockRegisterForm
                registerId={register.registerId}
              />
            </div>
          </Panel>
        </div>
      )}
    </main>
  );
}
